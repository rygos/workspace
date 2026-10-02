import { invoke, isTauri } from "@tauri-apps/api/core"
import { z } from "zod"
import type { PluginStorageApi } from "../core/persistence"
import { PluginManifestSchema } from "../plugins/contracts"
import type { StagedPluginCatalog } from "../plugins/installedCatalog"
import { SandboxedPluginFrame } from "../plugins/sandbox"
import type { StagedPluginRuntime } from "../plugins/stagedRuntime"
import type { PluginArtifactValidation } from "../plugins/stagingArtifact"
import { validateStagingArtifact } from "../plugins/stagingArtifact"

const StageListSchema = z
  .array(
    z.object({
      id: z.string().regex(/^stage-\d+-\d+$/),
      projectName: z.string(),
      createdAt: z.number().int().nonnegative(),
      status: z.enum(["complete", "incomplete"]),
    }),
  )
  .max(5)

const ArtifactSchema = z.object({
  id: z.string().regex(/^stage-\d+-\d+$/),
  manifest: z.string().max(16 * 1024),
  entrypoint: z.string().max(256 * 1024),
})

const PreviewStatusSchema = z.object({
  status: z.enum(["idle", "loading", "running", "failed", "stopped", "cancelled"]),
  pluginId: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
})
export type PluginPreviewStatus = z.infer<typeof PreviewStatusSchema>

export type { PluginArtifactValidation } from "../plugins/stagingArtifact"

export class PluginPreviewView {
  private readonly section = requiredElement<HTMLElement>("#staging-plugin-section")
  private readonly select = requiredElement<HTMLSelectElement>("#staging-plugin-select")
  private readonly openButton = requiredElement<HTMLButtonElement>("#staging-plugin-open")
  private readonly validateButton = requiredElement<HTMLButtonElement>("#staging-plugin-validate")
  private readonly activateButton = requiredElement<HTMLButtonElement>("#staging-plugin-activate")
  private readonly installButton = requiredElement<HTMLButtonElement>("#staging-plugin-install")
  private readonly reloadButton = requiredElement<HTMLButtonElement>("#staging-plugin-reload")
  private readonly deactivateButton = requiredElement<HTMLButtonElement>(
    "#staging-plugin-deactivate",
  )
  private readonly checks = requiredElement<HTMLOListElement>("#staging-plugin-checks")
  private readonly feedback = requiredElement<HTMLElement>("#staging-plugin-feedback")
  private readonly preview = requiredElement<HTMLElement>("#staging-plugin-preview")
  private readonly installedSelect = requiredElement<HTMLSelectElement>("#staging-installed-select")
  private readonly installedActivateButton = requiredElement<HTMLButtonElement>(
    "#staging-installed-activate",
  )
  private readonly installedRemoveButton = requiredElement<HTMLButtonElement>(
    "#staging-installed-remove",
  )
  private sandbox: SandboxedPluginFrame | undefined
  private generation = 0
  private lifecycle: PluginPreviewStatus = { status: "idle", updatedAt: Date.now() }

  constructor(
    private readonly hasWorkspace: () => boolean,
    private readonly runtime: StagedPluginRuntime,
    private readonly catalog: StagedPluginCatalog,
  ) {}

  mount(): void {
    this.openButton.addEventListener("click", () => void this.openPreview())
    this.validateButton.addEventListener("click", () => void this.validateSelected())
    this.activateButton.addEventListener("click", () => void this.activateSelected())
    this.installButton.addEventListener("click", () => void this.installSelected())
    this.reloadButton.addEventListener("click", () => void this.reloadSelected())
    this.deactivateButton.addEventListener("click", () => this.deactivateActive())
    this.select.addEventListener("change", () => this.updateRuntimeActions())
    this.installedSelect.addEventListener("change", () => this.updateInstalledActions())
    this.installedActivateButton.addEventListener("click", () => void this.activateInstalled())
    this.installedRemoveButton.addEventListener("click", () => void this.removeInstalled())
    this.runtime.subscribe(() => {
      this.updateRuntimeActions()
      this.updateInstalledActions()
    })
    requiredElement<HTMLDialogElement>("#settings-dialog").addEventListener("close", () => {
      this.close()
    })
  }

  async refresh(): Promise<void> {
    this.close()
    this.section.hidden = !isTauri()
    this.select.replaceChildren()
    this.installedSelect.replaceChildren()
    this.openButton.disabled = true
    this.validateButton.disabled = true
    this.activateButton.disabled = true
    this.installButton.disabled = true
    this.installedActivateButton.disabled = true
    this.installedRemoveButton.disabled = true
    if (this.section.hidden) return
    try {
      await this.refreshInstalledPlugins()
    } catch {
      this.feedback.textContent = "Die installierten Plugins konnten nicht geladen werden."
      return
    }
    if (!this.hasWorkspace()) {
      this.feedback.textContent = "Wähle einen Projektordner, um Staging-Kopien zu verwalten."
      return
    }
    this.feedback.textContent = "Staging-Kopien werden geladen …"
    try {
      const stages = StageListSchema.parse(await invoke<unknown>("list_staging_copies"))
      const available = stages.filter((stage) => stage.status === "complete")
      for (const stage of available) {
        const option = document.createElement("option")
        option.value = stage.id
        option.textContent = `${stage.projectName} · ${stage.id}`
        this.select.append(option)
      }
      const hasStages = available.length > 0
      this.openButton.disabled = !hasStages
      this.validateButton.disabled = !hasStages
      this.installButton.disabled = !hasStages
      this.updateRuntimeActions()
      this.feedback.textContent = hasStages
        ? "Vorschau führt den Code isoliert und mit flüchtigem Speicher aus."
        : "Keine vollständige Staging-Kopie vorhanden. Installierte Plugins bleiben verfügbar."
    } catch {
      this.feedback.textContent = "Die Staging-Kopien konnten nicht geladen werden."
    }
  }

  close(): void {
    this.generation += 1
    if (this.lifecycle.status === "running" || this.lifecycle.status === "loading") {
      this.setLifecycle("stopped")
    }
    this.clearPreview()
  }

  getStatus(): PluginPreviewStatus {
    return PreviewStatusSchema.parse(this.lifecycle)
  }

  async validateStagingPlugin(id: string): Promise<PluginArtifactValidation> {
    const artifact = ArtifactSchema.parse(await invoke<unknown>("load_staging_plugin", { id }))
    return validateStagingArtifact(id, artifact)
  }

  private async validateSelected(): Promise<void> {
    const id = this.select.value
    if (!/^stage-\d+-\d+$/.test(id)) return
    this.validateButton.disabled = true
    try {
      const report = await this.validateStagingPlugin(id)
      this.renderChecks(report)
      this.feedback.textContent = report.passed
        ? "Statische Akzeptanzprüfung bestanden. Der Start wird separat in der Sandbox geprüft."
        : "Statische Akzeptanzprüfung fehlgeschlagen."
    } catch {
      this.feedback.textContent = "Die statische Plugin-Prüfung konnte nicht ausgeführt werden."
    } finally {
      this.validateButton.disabled = false
    }
  }

  private async installSelected(): Promise<void> {
    const stageId = this.select.value
    if (!/^stage-\d+-\d+$/.test(stageId)) return
    this.installButton.disabled = true
    try {
      const report = await this.validateStagingPlugin(stageId)
      this.renderChecks(report)
      if (!report.passed) {
        this.feedback.textContent = "Installation abgebrochen: Akzeptanzprüfung fehlgeschlagen."
        return
      }
      const artifact = ArtifactSchema.parse(
        await invoke<unknown>("load_staging_plugin", { id: stageId }),
      )
      const manifest = PluginManifestSchema.parse(JSON.parse(artifact.manifest) as unknown)
      if (this.activePluginId() === manifest.id) {
        this.feedback.textContent =
          "Deaktiviere das Plugin vor einer Installation oder Aktualisierung."
        return
      }
      const installed = await this.catalog.find(manifest.id)
      const operation =
        installed === undefined ? "dauerhaft installieren" : "Installation aktualisieren"
      if (
        !window.confirm(
          `${manifest.name} (${manifest.id} · ${manifest.version}) ${operation}?\n\nDer gebündelte Einstieg wird lokal in Workshop gespeichert. Die Installation aktiviert oder führt den Code nicht aus. Beim Start nach einem Neustart ist eine erneute manuelle Aktivierung erforderlich.`,
        )
      ) {
        this.feedback.textContent = "Installation abgebrochen."
        return
      }
      await this.catalog.install(stageId, manifest, artifact.entrypoint)
      await this.refreshInstalledPlugins()
      this.feedback.textContent = `${manifest.name} wurde lokal installiert. Es wurde kein Plugin-Code ausgeführt.`
    } catch (error) {
      this.feedback.textContent =
        error instanceof Error ? error.message : "Plugin-Installation fehlgeschlagen."
    } finally {
      this.installButton.disabled = false
      this.updateRuntimeActions()
    }
  }

  private async activateInstalled(): Promise<void> {
    const pluginId = this.installedSelect.value
    if (pluginId.length === 0) return
    this.installedActivateButton.disabled = true
    try {
      const installed = await this.catalog.find(pluginId)
      if (installed === undefined) throw new Error("Das installierte Plugin wurde nicht gefunden.")
      const artifact = {
        id: installed.sourceStageId,
        manifest: JSON.stringify(installed.manifest),
        entrypoint: installed.entrypoint,
      }
      const report = validateStagingArtifact(installed.sourceStageId, artifact)
      this.renderChecks(report)
      if (!report.passed)
        throw new Error("Das installierte Plugin besteht die Akzeptanzprüfung nicht mehr.")
      if (
        !window.confirm(
          `${installed.manifest.name} (${pluginId} · ${installed.manifest.version}) jetzt im Arbeitsbereich ausführen?\n\nDer Code läuft isoliert in einer Sandbox und erhält nur die deklarierten Rechte. Diese Aktivierung gilt bis zum Schließen der App; nach einem Neustart startet das Plugin nicht automatisch.`,
        )
      ) {
        this.feedback.textContent = "Aktivierung abgebrochen."
        return
      }
      await this.runtime.activate(installed.sourceStageId, installed.manifest, installed.entrypoint)
      this.feedback.textContent =
        "Installiertes Plugin aktiviert; die 10-sekündige Beobachtungsphase läuft."
    } catch (error) {
      this.feedback.textContent =
        error instanceof Error
          ? error.message
          : "Installiertes Plugin konnte nicht aktiviert werden."
    } finally {
      this.updateInstalledActions()
      this.updateRuntimeActions()
    }
  }

  private async removeInstalled(): Promise<void> {
    const pluginId = this.installedSelect.value
    if (pluginId.length === 0) return
    try {
      const installed = await this.catalog.find(pluginId)
      if (installed === undefined) return
      if (
        !window.confirm(
          `Installation von ${installed.manifest.name} (${pluginId} · ${installed.manifest.version}) entfernen? Der Plugin-Code wird aus Workshops lokalem Installationskatalog gelöscht. Bereits gespeicherte Plugin-Daten bleiben für eine spätere Neuinstallation erhalten.`,
        )
      ) {
        this.feedback.textContent = "Entfernen abgebrochen."
        return
      }
      await this.catalog.uninstall(pluginId, this.activePluginId())
      await this.refreshInstalledPlugins()
      this.feedback.textContent = `${installed.manifest.name} wurde aus dem Installationskatalog entfernt.`
    } catch (error) {
      this.feedback.textContent =
        error instanceof Error ? error.message : "Installation konnte nicht entfernt werden."
    }
  }

  private async refreshInstalledPlugins(): Promise<void> {
    const installedPlugins = await this.catalog.list()
    this.installedSelect.replaceChildren()
    for (const installed of installedPlugins) {
      const option = document.createElement("option")
      option.value = installed.manifest.id
      option.textContent = `${installed.manifest.name} · v${installed.manifest.version}`
      this.installedSelect.append(option)
    }
    if (installedPlugins.length === 0) {
      const option = document.createElement("option")
      option.value = ""
      option.textContent = "Keine installierten Plugins"
      this.installedSelect.append(option)
    }
    this.updateInstalledActions()
  }

  private updateInstalledActions(): void {
    const pluginId = this.installedSelect.value
    const active = this.runtime.status
    const busy = ["starting", "reloading", "recovering"].includes(active.status)
    const activePluginId =
      active.status === "active" || active.status === "observing" ? active.pluginId : undefined
    this.installedActivateButton.disabled =
      pluginId.length === 0 || active.status === "active" || active.status === "observing" || busy
    this.installedRemoveButton.disabled =
      pluginId.length === 0 || activePluginId === pluginId || busy
  }

  private activePluginId(): string | undefined {
    const active = this.runtime.status
    return active.status === "active" || active.status === "observing" ? active.pluginId : undefined
  }

  private async activateSelected(): Promise<void> {
    const id = this.select.value
    if (!/^stage-\d+-\d+$/.test(id)) return
    this.activateButton.disabled = true
    try {
      const report = await this.validateStagingPlugin(id)
      this.renderChecks(report)
      if (!report.passed) {
        this.feedback.textContent =
          "Plugin nicht aktiviert: die statische Akzeptanzprüfung ist fehlgeschlagen."
        return
      }
      const artifact = ArtifactSchema.parse(await invoke<unknown>("load_staging_plugin", { id }))
      const manifest = PluginManifestSchema.parse(JSON.parse(artifact.manifest) as unknown)
      if (
        !window.confirm(
          `${manifest.name} (${manifest.id}@${manifest.version}) regulär im Arbeitsbereich aktivieren?\n\nBerechtigungen: ${manifest.permissions.join(", ") || "keine"}. Der Code bleibt in einer isolierten Sandbox; Plugin-Speicher wird dauerhaft gespeichert. Erneute Aktivierung nach einem App-Neustart erfolgt nicht automatisch.`,
        )
      ) {
        this.feedback.textContent = "Aktivierung abgebrochen."
        return
      }
      await this.runtime.activate(id, manifest, artifact.entrypoint)
      this.feedback.textContent = "Plugin aktiviert; die 10-sekündige Beobachtungsphase läuft."
    } catch (error) {
      this.feedback.textContent =
        error instanceof Error ? error.message : "Plugin-Aktivierung fehlgeschlagen."
    } finally {
      this.activateButton.disabled = false
      this.updateRuntimeActions()
    }
  }

  private async reloadSelected(): Promise<void> {
    const id = this.select.value
    if (!/^stage-\d+-\d+$/.test(id)) return
    this.reloadButton.disabled = true
    try {
      const report = await this.validateStagingPlugin(id)
      this.renderChecks(report)
      if (!report.passed) {
        this.feedback.textContent =
          "Hot Reload abgebrochen: die statische Akzeptanzprüfung ist fehlgeschlagen."
        return
      }
      const artifact = ArtifactSchema.parse(await invoke<unknown>("load_staging_plugin", { id }))
      const manifest = PluginManifestSchema.parse(JSON.parse(artifact.manifest) as unknown)
      const active = this.runtime.status
      if (active.pluginId !== manifest.id) {
        this.feedback.textContent =
          "Hot Reload erfordert dieselbe Plugin-ID wie die aktive Erweiterung."
        return
      }
      if (
        !window.confirm(
          `${manifest.name} (${manifest.id}@${manifest.version}) hot reloaden?\n\nBerechtigungen: ${manifest.permissions.join(", ") || "keine"}. Die bisherige Version bleibt aktiv, falls der neue Einstieg nicht startet.`,
        )
      ) {
        this.feedback.textContent = "Hot Reload abgebrochen."
        return
      }
      await this.runtime.hotReload(id, manifest, artifact.entrypoint)
      this.feedback.textContent =
        "Hot Reload gestartet; die neue Version wird 10 Sekunden beobachtet."
    } catch (error) {
      this.feedback.textContent =
        error instanceof Error ? error.message : "Hot Reload fehlgeschlagen."
    } finally {
      this.reloadButton.disabled = false
      this.updateRuntimeActions()
    }
  }

  private deactivateActive(): void {
    const active = this.runtime.status
    if (active.status !== "active" && active.status !== "observing") return
    if (!window.confirm(`${active.name ?? active.pluginId} deaktivieren?`)) return
    this.runtime.deactivate()
    this.feedback.textContent = "Staging-Plugin deaktiviert."
    this.updateRuntimeActions()
  }

  private updateRuntimeActions(): void {
    const active = this.runtime.status
    const hasStage = /^stage-\d+-\d+$/.test(this.select.value)
    const running =
      active.status === "active" ||
      active.status === "observing" ||
      active.status === "starting" ||
      active.status === "reloading" ||
      active.status === "recovering"
    const busy =
      active.status === "starting" ||
      active.status === "reloading" ||
      active.status === "recovering"
    const canDeactivate = active.status === "active" || active.status === "observing"
    this.deactivateButton.disabled = !canDeactivate
    this.reloadButton.disabled = active.status !== "active" || !hasStage || !this.hasWorkspace()
    this.activateButton.disabled = running || !hasStage || !this.hasWorkspace()
    this.installButton.disabled = !hasStage || !this.hasWorkspace() || busy
  }

  private renderChecks(report: PluginArtifactValidation): void {
    this.checks.replaceChildren()
    for (const check of report.checks) {
      const item = document.createElement("li")
      item.className = "plugin-list__item"
      item.textContent = `${check.passed ? "Bestanden" : "Fehlgeschlagen"}: ${check.message}`
      this.checks.append(item)
    }
  }

  async previewStagingPlugin(id: string): Promise<PluginPreviewStatus> {
    if (!/^stage-\d+-\d+$/.test(id) || !this.hasWorkspace()) {
      return this.getStatus()
    }
    const settings = requiredElement<HTMLDialogElement>("#settings-dialog")
    if (!settings.open) settings.showModal()
    await this.refresh()
    this.select.value = id
    await this.startPreview(id)
    return this.getStatus()
  }

  private setLifecycle(
    status: PluginPreviewStatus["status"],
    manifest?: { readonly id: string; readonly name: string; readonly version: string },
  ): void {
    this.lifecycle = PreviewStatusSchema.parse({
      status,
      ...(manifest === undefined
        ? {
            ...(this.lifecycle.pluginId === undefined ? {} : { pluginId: this.lifecycle.pluginId }),
            ...(this.lifecycle.name === undefined ? {} : { name: this.lifecycle.name }),
            ...(this.lifecycle.version === undefined ? {} : { version: this.lifecycle.version }),
          }
        : { pluginId: manifest.id, name: manifest.name, version: manifest.version }),
      updatedAt: Date.now(),
    })
  }

  private clearPreview(): void {
    this.sandbox?.unmount()
    this.sandbox = undefined
    this.preview.replaceChildren()
    this.preview.hidden = true
  }

  private async openPreview(): Promise<void> {
    const id = this.select.value
    await this.startPreview(id)
  }

  private async startPreview(id: string): Promise<void> {
    if (!/^stage-\d+-\d+$/.test(id) || !this.hasWorkspace()) return
    this.close()
    this.lifecycle = { status: "idle", updatedAt: Date.now() }
    const generation = this.generation
    this.openButton.disabled = true
    this.setLifecycle("loading")
    this.feedback.textContent = "Plugin-Artefakt wird geprüft …"
    try {
      const artifact = ArtifactSchema.parse(await invoke<unknown>("load_staging_plugin", { id }))
      if (generation !== this.generation) return
      const rawManifest: unknown = JSON.parse(artifact.manifest)
      const manifest = PluginManifestSchema.parse(rawManifest)
      if (manifest.entrypoint !== "plugin.js") {
        throw new Error("Das Manifest muss den gebündelten Einstieg plugin.js verwenden.")
      }
      if (manifest.permissions.some((permission) => permission !== "storage")) {
        throw new Error("Die Vorschau unterstützt derzeit keine Ereignis- oder Fähigkeitsrechte.")
      }
      const permissions = manifest.permissions.length === 0 ? "keine" : "lokaler Vorschau-Speicher"
      if (
        !window.confirm(
          `${manifest.name} (${manifest.id} · ${manifest.version}) in isolierter Vorschau ausführen?\n\nDeklarierte Rechte: ${permissions}. Speicherdaten bleiben temporär und werden beim Schließen verworfen. Die Sandbox begrenzt Zugriffe, aber keine CPU- oder Speichernutzung.`,
        )
      ) {
        this.setLifecycle("cancelled", manifest)
        this.feedback.textContent = "Vorschau nicht gestartet."
        return
      }
      if (generation !== this.generation) return
      const sandbox = new SandboxedPluginFrame(manifest, new PreviewStorage(), () => {
        if (generation !== this.generation) return
        this.setLifecycle("failed", manifest)
        this.clearPreview()
        this.feedback.textContent = `${manifest.name} ist während der Vorschau fehlgeschlagen.`
      })
      this.sandbox = sandbox
      this.preview.hidden = false
      await sandbox.mount(this.preview, artifact.entrypoint)
      if (generation !== this.generation) return
      this.setLifecycle("running", manifest)
      this.feedback.textContent = `${manifest.name} läuft isoliert in der Vorschau.`
    } catch (error) {
      if (generation !== this.generation) return
      this.setLifecycle("failed")
      this.clearPreview()
      this.feedback.textContent =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Das Plugin-Artefakt konnte nicht geladen werden."
    } finally {
      if (generation === this.generation) this.openButton.disabled = false
    }
  }
}

class PreviewStorage implements PluginStorageApi {
  private static readonly MAX_ENTRIES = 128
  private static readonly MAX_BYTES = 1024 * 1024
  private readonly values = new Map<string, unknown>()
  private bytes = 0

  async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const value = this.values.get(key)
    if (value === undefined) return undefined
    return schema.parse(value)
  }

  async set<T>(key: string, value: T, schema: z.ZodType<T>): Promise<void> {
    const parsed = schema.parse(value)
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(parsed)
    } catch {
      throw new Error("Der Vorschau-Speicherwert ist nicht serialisierbar.")
    }
    if (serialized === undefined) throw new Error("Der Vorschau-Speicherwert ist ungültig.")
    const nextBytes = new TextEncoder().encode(serialized).byteLength
    const previous = this.values.get(key)
    const previousSize = previous === undefined ? 0 : storageValueSize(previous)
    if (previous === undefined && this.values.size >= PreviewStorage.MAX_ENTRIES) {
      throw new Error("Der Vorschau-Speicher enthält zu viele Einträge.")
    }
    if (this.bytes - previousSize + nextBytes > PreviewStorage.MAX_BYTES) {
      throw new Error("Der Vorschau-Speicher ist voll.")
    }
    this.values.set(key, parsed)
    this.bytes = this.bytes - previousSize + nextBytes
  }

  async remove(key: string): Promise<void> {
    const previous = this.values.get(key)
    if (previous !== undefined) this.bytes -= storageValueSize(previous)
    this.values.delete(key)
  }
}

function storageValueSize(value: unknown): number {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? 0 : new TextEncoder().encode(serialized).byteLength
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return element
}
