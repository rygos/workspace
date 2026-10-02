import type { ZodType } from "zod"
import type { Logger } from "../core/logger"
import type { PluginStorageApi } from "../core/persistence"
import type { CapabilityRegistry } from "./capabilityRegistry"
import type { PluginManifest, PluginStatus, WorkshopEvent } from "./contracts"
import { PluginManifestSchema } from "./contracts"
import type { EventBus } from "./eventBus"
import type { LifecycleSupervisor } from "./lifecycleSupervisor"

export type PluginDefinition<Contracts extends object, Event extends WorkshopEvent> = {
  readonly manifest: unknown
  readonly activate: (
    context: PluginContext<Contracts, Event>,
  ) => Promise<() => void> | (() => void)
}

export type PluginContext<Contracts extends object, Event extends WorkshopEvent> = {
  readonly manifest: PluginManifest
  readonly storage: PluginStorageApi
  readonly events: {
    readonly subscribe: (listener: (event: Event) => void) => () => void
    readonly emit: (event: Event) => void
  }
  readonly capabilities: {
    readonly register: <K extends keyof Contracts>(key: K, capability: Contracts[K]) => () => void
    readonly resolve: <K extends keyof Contracts>(key: K) => Contracts[K] | undefined
  }
}

type PluginRecord = {
  readonly manifest: PluginManifest
  status: PluginStatus
  cleanup: (() => void) | undefined
}

export class PluginRuntime<Contracts extends object, Event extends WorkshopEvent> {
  private readonly plugins = new Map<string, PluginRecord>()

  constructor(
    private readonly capabilities: CapabilityRegistry<Contracts>,
    private readonly events: EventBus<Event>,
    private readonly storageFor: (pluginId: string) => PluginStorageApi,
    private readonly logger: Logger,
    private readonly supervisor?: LifecycleSupervisor,
  ) {}

  async activate(definition: PluginDefinition<Contracts, Event>): Promise<PluginStatus> {
    return this.activateDefinition(definition, false)
  }

  async activateLastKnownGood(
    definition: PluginDefinition<Contracts, Event>,
  ): Promise<PluginStatus> {
    return this.activateDefinition(definition, true)
  }

  private async activateDefinition(
    definition: PluginDefinition<Contracts, Event>,
    allowQuarantined: boolean,
  ): Promise<PluginStatus> {
    const parsed = PluginManifestSchema.safeParse(definition.manifest)
    if (!parsed.success) throw new Error("Das Plugin-Manifest ist ungültig.")
    const manifest = Object.freeze(parsed.data)
    const existing = this.plugins.get(manifest.id)
    const canRecoverQuarantined = allowQuarantined && existing?.status === "quarantined"
    if (
      existing !== undefined &&
      existing.status !== "failed" &&
      existing.status !== "disabled" &&
      !canRecoverQuarantined
    ) {
      throw new Error(`Plugin ist bereits geladen: ${manifest.id}`)
    }
    const blocked = await this.supervisor?.blockedStatus(manifest.id)
    if (blocked === "disabled" || (blocked === "quarantined" && !allowQuarantined)) {
      this.plugins.set(manifest.id, { manifest, status: blocked, cleanup: undefined })
      return blocked
    }
    for (const dependency of manifest.dependencies) {
      const active = this.plugins.get(dependency.id)
      if (active?.status !== "active" || active.manifest.version !== dependency.version) {
        throw new Error(
          `Plugin-Abhängigkeit nicht verfügbar: ${dependency.id}@${dependency.version}`,
        )
      }
    }

    const record: PluginRecord = existing ?? { manifest, status: "validated", cleanup: undefined }
    record.status = "validated"
    record.cleanup = undefined
    this.plugins.set(manifest.id, record)
    const cleanupTasks: Array<() => void> = []
    try {
      record.status = "loaded"
      const requirePermission = (permission: PluginManifest["permissions"][number]): void => {
        if (!manifest.permissions.includes(permission)) {
          throw new Error(`Plugin ${manifest.id} besitzt nicht die Berechtigung ${permission}.`)
        }
      }
      const storage: PluginStorageApi = {
        get: async <T>(key: string, schema: ZodType<T>) => {
          requirePermission("storage")
          return this.storageFor(manifest.id).get(key, schema)
        },
        set: async <T>(key: string, value: T, schema: ZodType<T>) => {
          requirePermission("storage")
          await this.storageFor(manifest.id).set(key, value, schema)
        },
        remove: async (key: string) => {
          requirePermission("storage")
          await this.storageFor(manifest.id).remove(key)
        },
      }
      const events = {
        subscribe: (listener: (event: Event) => void) => {
          requirePermission("events")
          const unsubscribe = this.events.subscribe((event) => {
            if (!manifest.events.includes(event.type)) return
            try {
              listener(event)
            } catch (error) {
              void this.isolate(record, error).catch(() => {
                this.logger.error(
                  "plugin-runtime",
                  `Fehlerisolation fehlgeschlagen: ${manifest.id}`,
                )
              })
            }
          })
          cleanupTasks.push(unsubscribe)
          return unsubscribe
        },
        emit: (event: Event) => {
          requirePermission("events")
          if (!manifest.events.includes(event.type)) {
            throw new Error(`Plugin ${manifest.id} darf ${event.type} nicht aussenden.`)
          }
          this.events.emit(event)
        },
      }
      const capabilities = {
        register: <K extends keyof Contracts>(key: K, capability: Contracts[K]) => {
          requirePermission("capabilities")
          if (!manifest.provides.includes(String(key))) {
            throw new Error(`Capability ${String(key)} ist nicht im Manifest deklariert.`)
          }
          const unregister = this.capabilities.register(key, manifest.id, capability)
          cleanupTasks.push(unregister)
          return unregister
        },
        resolve: <K extends keyof Contracts>(key: K) => {
          requirePermission("capabilities")
          if (!manifest.consumes.includes(String(key))) {
            throw new Error(`Capability ${String(key)} ist nicht im Manifest deklariert.`)
          }
          return this.capabilities.resolve(key, manifest.id)
        },
      }
      const cleanup = await definition.activate({ manifest, storage, events, capabilities })
      record.cleanup = () => {
        try {
          cleanup()
        } finally {
          rollbackAll(cleanupTasks, (message) => this.logger.error("plugin-runtime", message))
        }
      }
      record.status = "active"
      this.logger.info("plugin-runtime", `Plugin aktiviert: ${manifest.id}@${manifest.version}`)
    } catch (error) {
      rollbackAll(cleanupTasks, (message) => this.logger.error("plugin-runtime", message))
      record.status = "failed"
      try {
        record.status =
          (await this.supervisor?.recordFailure(manifest.id, error, manifest.version)) ?? "failed"
      } catch {
        this.logger.error(
          "plugin-runtime",
          `Incident konnte nicht gespeichert werden: ${manifest.id}`,
        )
      }
      this.logger.error(
        "plugin-runtime",
        `Plugin-Aktivierung fehlgeschlagen: ${manifest.id} (${errorMessage(error)})`,
      )
    }
    return record.status
  }

  async markObservedHealthy(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId)
    if (plugin?.status !== "active") throw new Error(`Plugin ist nicht aktiv: ${pluginId}`)
    await this.supervisor?.recordObservedHealthy(pluginId, plugin.manifest.version)
  }

  async deactivate(pluginId: string): Promise<PluginStatus> {
    const record = this.plugins.get(pluginId)
    if (record === undefined) throw new Error(`Plugin wurde nicht gefunden: ${pluginId}`)
    try {
      record.cleanup?.()
      record.cleanup = undefined
      record.status = "disabled"
      this.logger.info("plugin-runtime", `Plugin deaktiviert: ${pluginId}`)
    } catch (error) {
      record.status = "failed"
      this.logger.error("plugin-runtime", `Plugin-Deaktivierung fehlgeschlagen: ${pluginId}`)
      try {
        record.status =
          (await this.supervisor?.recordFailure(pluginId, error, record.manifest.version)) ??
          "failed"
      } catch {
        this.logger.error("plugin-runtime", `Incident konnte nicht gespeichert werden: ${pluginId}`)
      }
    }
    return record.status
  }

  status(pluginId: string): PluginStatus | undefined {
    return this.plugins.get(pluginId)?.status
  }

  list(): readonly { readonly manifest: PluginManifest; readonly status: PluginStatus }[] {
    return [...this.plugins.values()].map(({ manifest, status }) => ({ manifest, status }))
  }

  private async isolate(record: PluginRecord, error: unknown): Promise<void> {
    record.status = "failed"
    try {
      record.cleanup?.()
    } catch {
      this.logger.error("plugin-runtime", `Plugin-Cleanup fehlgeschlagen: ${record.manifest.id}`)
    }
    record.cleanup = undefined
    try {
      record.status =
        (await this.supervisor?.recordFailure(
          record.manifest.id,
          error,
          record.manifest.version,
        )) ?? "failed"
    } catch {
      this.logger.error(
        "plugin-runtime",
        `Incident konnte nicht gespeichert werden: ${record.manifest.id}`,
      )
    }
  }
}

function rollbackAll(cleanups: Array<() => void>, logError: (message: string) => void): void {
  for (const rollback of cleanups.reverse()) {
    try {
      rollback()
    } catch {
      logError("Plugin-Rollback konnte eine Ressource nicht freigeben.")
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.name : "unbekannter Fehler"
}
