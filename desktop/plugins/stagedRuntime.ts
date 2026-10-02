import type { PluginStorageApi } from "../core/persistence"
import type { PluginManifest } from "./contracts"
import { SandboxedPluginFrame } from "./sandbox"
import { StagedPluginFailureChannel } from "./stagedRuntimeFailures"
import {
  HOT_RELOAD_OBSERVATION_MS,
  type LoadedPlugin,
  type StagedRuntimeState,
  scheduleAfter,
  snapshot,
  stateFor,
} from "./stagedRuntimeTypes"
import { renderStagedRuntimeState } from "./stagedRuntimeView"
import { parseStagedPluginManifest } from "./stagingArtifact"
import { TransactionalPluginStorage } from "./transactionalPluginStorage"

export type StagedRuntimeProtection = {
  readonly isQuarantined: (pluginId: string) => Promise<boolean>
  readonly clearQuarantine: (pluginId: string) => Promise<void>
}

export class StagedPluginRuntime {
  readonly failures = new StagedPluginFailureChannel()
  private active: LoadedPlugin | undefined
  private state: StagedRuntimeState = { status: "inactive" }
  private readonly stateListeners = new Set<(state: StagedRuntimeState) => void>()
  private cancelObservation: (() => void) | undefined

  constructor(
    private readonly mountPoint: HTMLElement,
    private readonly storageFor: (pluginId: string) => PluginStorageApi,
    private readonly registeredPluginIds: () => Promise<readonly string[]>,
    private readonly scheduleObservation: (
      elapsed: () => void,
      delayMs: number,
    ) => () => void = scheduleAfter,
    private readonly protection: StagedRuntimeProtection = {
      isQuarantined: async () => false,
      clearQuarantine: async () => undefined,
    },
  ) {
    this.publishState(this.state)
  }

  get status(): StagedRuntimeState {
    return { ...this.state }
  }

  subscribe(listener: (state: StagedRuntimeState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.status)
    return () => this.stateListeners.delete(listener)
  }

  async activate(
    stageId: string,
    manifestInput: unknown,
    entrypoint: string,
  ): Promise<StagedRuntimeState> {
    if (this.active !== undefined) throw new Error("Eine Staging-Erweiterung ist bereits aktiv.")
    const manifest = parseStagedPluginManifest(manifestInput, entrypoint)
    if (await this.isQuarantined(manifest.id)) {
      throw new Error(
        "Diese Staging-Erweiterung ist quarantänisiert und muss manuell freigegeben werden.",
      )
    }
    if ((await this.registeredPluginIds()).includes(manifest.id)) {
      throw new Error("Diese Plugin-ID ist bereits durch die App registriert.")
    }
    this.publishState(stateFor("starting", { stageId, manifest }))
    let loaded: LoadedPlugin
    try {
      loaded = await this.loadCandidate(stageId, manifest, entrypoint)
    } catch (error) {
      this.publishState({ status: "inactive" })
      throw error
    }
    if (loaded.hasFailed()) {
      await loaded.storage.rollback()
      loaded.sandbox.unmount()
      loaded.temporaryMount.remove()
      this.publishState({ status: "inactive" })
      throw new Error("Das Plugin ist während der Aktivierung fehlgeschlagen.")
    }
    this.active = loaded
    this.mountPoint.replaceChildren(loaded.frame)
    loaded.temporaryMount.remove()
    loaded.storage.finalize()
    this.mountPoint.hidden = false
    this.beginObservation(loaded)
    return this.status
  }

  async hotReload(
    stageId: string,
    manifestInput: unknown,
    entrypoint: string,
  ): Promise<StagedRuntimeState> {
    const previous = this.active
    if (previous === undefined) throw new Error("Es ist keine Staging-Erweiterung aktiv.")
    const manifest = parseStagedPluginManifest(manifestInput, entrypoint)
    if (await this.isQuarantined(manifest.id)) {
      throw new Error(
        "Diese Staging-Erweiterung ist quarantänisiert und muss manuell freigegeben werden.",
      )
    }
    if (manifest.id !== previous.manifest.id) {
      throw new Error("Hot Reload erfordert dieselbe Plugin-ID wie die aktive Erweiterung.")
    }
    if (
      previous.entrypoint === entrypoint &&
      JSON.stringify(previous.manifest) === JSON.stringify(manifest)
    ) {
      return this.status
    }

    if (this.state.status === "observing") {
      throw new Error("Während der Beobachtungsphase ist kein weiterer Hot Reload möglich.")
    }
    this.publishState(stateFor("reloading", previous))
    let loaded: LoadedPlugin
    try {
      loaded = await this.loadCandidate(stageId, manifest, entrypoint)
    } catch (error) {
      if (this.active === previous) this.publishState(stateFor("active", previous))
      throw error
    }
    if (loaded.hasFailed()) {
      await loaded.storage.rollback()
      loaded.sandbox.unmount()
      loaded.temporaryMount.remove()
      if (this.active === previous) this.publishState(stateFor("active", previous))
      throw new Error("Der Hot-Reload-Kandidat ist während des Starts fehlgeschlagen.")
    }
    if (this.active !== previous) {
      loaded.sandbox.unmount()
      await loaded.storage.rollback()
      loaded.temporaryMount.remove()
      throw new Error("Die aktive Erweiterung wurde während des Hot Reloads beendet.")
    }
    this.mountPoint.replaceChildren(loaded.frame)
    loaded.temporaryMount.remove()
    previous.sandbox.unmount()
    this.active = { ...loaded, fallback: snapshot(previous) }
    loaded.storage.finalize()
    this.mountPoint.hidden = false
    this.beginObservation(this.active)
    return this.status
  }

  deactivate(): StagedRuntimeState {
    this.cancelObservation?.()
    this.cancelObservation = undefined
    this.active?.storage.accept()
    this.active?.sandbox.unmount()
    this.active = undefined
    this.mountPoint.replaceChildren()
    this.mountPoint.hidden = true
    this.publishState({ status: "inactive" })
    return this.status
  }

  async isQuarantined(pluginId: string): Promise<boolean> {
    return this.protection.isQuarantined(pluginId)
  }

  async clearQuarantine(pluginId: string): Promise<void> {
    await this.protection.clearQuarantine(pluginId)
  }

  quarantine(pluginId: string): void {
    if (
      this.active?.manifest.id === pluginId &&
      (this.state.status === "active" || this.state.status === "observing")
    ) {
      this.deactivate()
    }
  }

  private async loadCandidate(
    stageId: string,
    manifest: PluginManifest,
    entrypoint: string,
  ): Promise<LoadedPlugin> {
    const storage = new TransactionalPluginStorage(this.storageFor(manifest.id))
    let failed = false
    let sandbox: SandboxedPluginFrame
    sandbox = new SandboxedPluginFrame(manifest, storage, () => {
      failed = true
      const failedPlugin = this.active
      if (failedPlugin?.sandbox !== sandbox) {
        sandbox.unmount()
        return
      }
      sandbox.unmount()
      this.active = undefined
      this.mountPoint.replaceChildren()
      this.mountPoint.hidden = true
      this.publishState(stateFor("failed", failedPlugin))
      this.failures.publish(failedPlugin)
      void this.recoverFailedPlugin(failedPlugin)
    })
    const temporaryMount = document.createElement("div")
    temporaryMount.hidden = true
    document.body.append(temporaryMount)
    try {
      await sandbox.mount(temporaryMount, entrypoint)
      if (failed) throw new Error("Das Plugin ist während der Aktivierung fehlgeschlagen.")
      await storage.commit()
      if (failed) throw new Error("Das Plugin ist während der Aktivierung fehlgeschlagen.")
      const frame = temporaryMount.firstElementChild
      if (!(frame instanceof HTMLIFrameElement)) {
        throw new Error("Die Plugin-Sandbox konnte nicht in den Arbeitsbereich übernommen werden.")
      }
      return {
        stageId,
        manifest,
        entrypoint,
        sandbox,
        frame,
        temporaryMount,
        storage,
        fallback: undefined,
        hasFailed: () => failed,
      }
    } catch (error) {
      sandbox.unmount()
      await storage.rollback()
      temporaryMount.remove()
      throw error
    }
  }

  private async recoverFailedPlugin(failed: LoadedPlugin): Promise<void> {
    if (this.state.status !== "failed" || this.state.pluginId !== failed.manifest.id) return
    this.publishState(stateFor("recovering", failed))
    try {
      await failed.storage.rollback()
      if (await this.isQuarantined(failed.manifest.id)) {
        this.publishState(stateFor("failed", failed))
        return
      }
      const fallback = failed.fallback
      if (fallback === undefined) {
        this.publishState(stateFor("failed", failed))
        return
      }
      const restored = await this.loadCandidate(
        fallback.stageId,
        fallback.manifest,
        fallback.entrypoint,
      )
      if (await this.isQuarantined(failed.manifest.id)) {
        await restored.storage.rollback()
        restored.sandbox.unmount()
        restored.temporaryMount.remove()
        this.publishState(stateFor("failed", failed))
        return
      }
      if (restored.hasFailed()) {
        await restored.storage.rollback()
        restored.sandbox.unmount()
        restored.temporaryMount.remove()
        throw new Error("Die vorherige Plugin-Version ist ebenfalls fehlgeschlagen.")
      }
      const active = {
        ...restored,
        fallback: fallback.fallback,
      }
      this.mountPoint.replaceChildren(active.frame)
      active.temporaryMount.remove()
      active.storage.finalize()
      this.active = active
      this.mountPoint.hidden = false
      this.beginObservation(active)
    } catch {
      this.active = undefined
      this.mountPoint.replaceChildren()
      this.mountPoint.hidden = true
      this.publishState(stateFor("failed", failed))
    }
  }

  private publishState(state: StagedRuntimeState): void {
    this.state = state
    renderStagedRuntimeState(state)
    for (const listener of this.stateListeners) listener(this.status)
  }

  private beginObservation(plugin: LoadedPlugin): void {
    this.publishState(stateFor("observing", plugin))
    this.cancelObservation?.()
    this.cancelObservation = this.scheduleObservation(() => {
      if (this.active?.sandbox !== plugin.sandbox) return
      plugin.storage.accept()
      this.active = { ...plugin, fallback: undefined }
      this.cancelObservation = undefined
      this.publishState(stateFor("active", this.active))
    }, HOT_RELOAD_OBSERVATION_MS)
  }
}
