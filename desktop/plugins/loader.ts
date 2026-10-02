import type { IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import type { PluginManifest, WorkshopEvent } from "./contracts"
import { PluginManifestSchema } from "./contracts"
import type { PluginDefinition } from "./runtime"

export type PluginModule<Contracts extends object, Event extends WorkshopEvent> = {
  readonly manifest: unknown
  readonly activate: PluginDefinition<Contracts, Event>["activate"]
}

export type PluginImporter<Contracts extends object, Event extends WorkshopEvent> = () => Promise<
  PluginModule<Contracts, Event>
>

export type PluginDiscovery<Contracts extends object, Event extends WorkshopEvent> = {
  readonly definitions: readonly DiscoveredPlugin<Contracts, Event>[]
  readonly rejected: number
}

export type DiscoveredPlugin<Contracts extends object, Event extends WorkshopEvent> = Omit<
  PluginDefinition<Contracts, Event>,
  "manifest"
> & {
  readonly manifest: PluginManifest
}

export class PluginLoader<Contracts extends object, Event extends WorkshopEvent> {
  constructor(
    private readonly importers: Readonly<Record<string, PluginImporter<Contracts, Event>>>,
    private readonly logger: Logger,
    private readonly incidents?: IncidentJournal,
  ) {}

  async discover(): Promise<PluginDiscovery<Contracts, Event>> {
    const definitions: DiscoveredPlugin<Contracts, Event>[] = []
    const ids = new Set<string>()
    let rejected = 0

    for (const [registeredId, importer] of Object.entries(this.importers)) {
      try {
        if (!isPluginId(registeredId)) throw new Error("InvalidPluginRegistration")
        const module = await importer()
        const parsed = PluginManifestSchema.safeParse(module.manifest)
        if (!parsed.success || parsed.data.id !== registeredId || ids.has(registeredId)) {
          throw new Error("InvalidPluginManifest")
        }
        if (typeof module.activate !== "function") throw new Error("InvalidPluginEntryPoint")
        ids.add(registeredId)
        definitions.push({ manifest: parsed.data, activate: module.activate })
        this.logger.info("plugin-loader", `Plugin-Modul entdeckt: ${registeredId}`)
      } catch (error) {
        rejected += 1
        this.logger.warn("plugin-loader", `Plugin-Modul abgelehnt: ${registeredId}`)
        await this.recordRejection(error, registeredId)
      }
    }

    return { definitions, rejected }
  }

  private async recordRejection(error: unknown, registeredId: string): Promise<void> {
    if (this.incidents === undefined) return
    const sourceId = isPluginId(registeredId) ? `plugin:${registeredId}` : "core:plugin-loader"
    try {
      await this.incidents.create({
        sourceId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        severity: "error",
        status: "isolated",
      })
    } catch {
      this.logger.error("plugin-loader", "Plugin-Incident konnte nicht gespeichert werden.")
    }
  }
}

function isPluginId(value: string): boolean {
  return /^[a-z][a-z0-9-]{1,62}$/.test(value)
}
