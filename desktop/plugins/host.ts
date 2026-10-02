import type { IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import type { PluginStorageApi } from "../core/persistence"
import { CapabilityRegistry } from "./capabilityRegistry"
import type { PluginManifest, PluginStatus } from "./contracts"
import type { DemoCapabilities, DemoEvent, NotesService } from "./demoNotes"
import { analyzePluginDependencies } from "./dependencyAnalysis"
import { EventBus } from "./eventBus"
import type { SupervisorPolicy } from "./lifecycleSupervisor"
import { LifecycleSupervisor } from "./lifecycleSupervisor"
import type { DiscoveredPlugin } from "./loader"
import { PluginLoader } from "./loader"
import { PluginRuntime } from "./runtime"

export type PluginOverview = {
  readonly manifest: PluginManifest
  readonly status: PluginStatus
  readonly lastKnownGoodVersion: string | undefined
  readonly lastKnownGoodAvailable: boolean
  readonly quarantined: boolean
  readonly quarantineExpiresAt: number | undefined
}

export type PluginHostOptions = {
  readonly storageFor: (pluginId: string) => PluginStorageApi
  readonly incidents: IncidentJournal
  readonly logger: Logger
  readonly supervisorPolicy?: () => SupervisorPolicy
}

export class PluginNotFoundError extends Error {
  readonly name = "PluginNotFoundError"

  constructor(readonly pluginId: string) {
    super(`Plugin wurde nicht gefunden: ${pluginId}`)
  }
}

export class PluginVersionUnavailableError extends Error {
  readonly name = "PluginVersionUnavailableError"

  constructor(
    readonly pluginId: string,
    readonly version: string,
  ) {
    super(`Plugin-Version ist nicht verfügbar: ${pluginId}@${version}`)
  }
}

export class PluginActivationError extends Error {
  readonly name = "PluginActivationError"

  constructor(readonly pluginId: string) {
    super(`Plugin konnte nicht aktiviert werden: ${pluginId}`)
  }
}

export class WorkshopPluginHost {
  private readonly capabilities = new CapabilityRegistry<DemoCapabilities>()
  private readonly events = new EventBus<DemoEvent>()
  private readonly supervisor: LifecycleSupervisor
  private readonly runtime: PluginRuntime<DemoCapabilities, DemoEvent>
  private readonly loader: PluginLoader<DemoCapabilities, DemoEvent>
  private readonly definitions = new Map<string, DiscoveredPlugin<DemoCapabilities, DemoEvent>>()

  constructor(private readonly options: PluginHostOptions) {
    this.supervisor = new LifecycleSupervisor(
      options.incidents,
      options.logger,
      options.supervisorPolicy,
    )
    this.runtime = new PluginRuntime(
      this.capabilities,
      this.events,
      options.storageFor,
      options.logger,
      this.supervisor,
    )
    this.loader = new PluginLoader(
      { "demo-notes": async () => (await import("./demoNotes")).demoNotesPlugin },
      options.logger,
      options.incidents,
    )
  }

  async discover(): Promise<number> {
    const result = await this.loader.discover()
    for (const definition of result.definitions) {
      this.definitions.set(definition.manifest.id, definition)
    }
    return result.rejected
  }

  async list(): Promise<readonly PluginOverview[]> {
    return Promise.all(
      [...this.definitions].map(async ([pluginId, definition]) => {
        const [lastKnownGoodVersion, quarantined, quarantineExpiresAt] = await Promise.all([
          this.options.incidents.lastKnownGood(pluginId),
          this.options.incidents.quarantined(pluginId),
          this.options.incidents.quarantineExpiresAt(pluginId),
        ])
        const runtimeStatus = this.runtime.status(pluginId) ?? "discovered"
        return {
          manifest: definition.manifest,
          status: runtimeStatus === "quarantined" && !quarantined ? "disabled" : runtimeStatus,
          lastKnownGoodVersion,
          lastKnownGoodAvailable: lastKnownGoodVersion === definition.manifest.version,
          quarantined,
          quarantineExpiresAt,
        }
      }),
    )
  }

  async activate(pluginId: string): Promise<PluginStatus> {
    return this.runtime.activate(this.requireDefinition(pluginId))
  }

  async deactivate(pluginId: string): Promise<PluginStatus> {
    return this.runtime.deactivate(pluginId)
  }

  async markObservedHealthy(pluginId: string): Promise<void> {
    return this.runtime.markObservedHealthy(pluginId)
  }

  async restoreLastKnownGood(pluginId: string): Promise<boolean> {
    const version = await this.options.incidents.lastKnownGood(pluginId)
    const definition = this.requireDefinition(pluginId)
    if (version === undefined || definition.manifest.version !== version) return false

    const currentStatus = this.runtime.status(pluginId)
    if (currentStatus === "active") {
      const status = await this.runtime.deactivate(pluginId)
      if (status !== "disabled") throw new PluginActivationError(pluginId)
    }

    return this.supervisor.restoreLastKnownGood(pluginId, async (version) => {
      const definition = this.requireDefinition(pluginId)
      if (definition.manifest.version !== version) {
        throw new PluginVersionUnavailableError(pluginId, version)
      }
      const status = await this.runtime.activateLastKnownGood(definition)
      if (status !== "active") throw new PluginActivationError(pluginId)
    })
  }

  notes(): NotesService | undefined {
    return this.capabilities.resolve("notes.v1", "workshop-ui")
  }

  dependencyGraph() {
    return {
      runtimeCapabilities: this.capabilities.dependencyGraph(),
      declared: analyzePluginDependencies(
        [...this.definitions.values()].map(({ manifest }) => manifest),
      ),
    }
  }

  diagnosticSourceContext(pluginId: string): string | undefined {
    const definition = this.definitions.get(pluginId)
    return definition?.activate.toString().slice(0, 4_096)
  }

  private requireDefinition(pluginId: string) {
    const definition = this.definitions.get(pluginId)
    if (definition === undefined) throw new PluginNotFoundError(pluginId)
    return definition
  }
}
