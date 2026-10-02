import type { Incident, IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import type { Settings } from "../core/model"
import type { OpenAICompatibleProvider } from "../core/provider"
import type { StagedPluginRuntime } from "../plugins/stagedRuntime"
import type { StagedPluginRuntimeFailure } from "../plugins/stagedRuntimeFailures"
import { diagnoseIncident } from "./incidentDiagnosis"
import { StagedPluginRepairer } from "./stagedPluginRepair"

export type RepairAgentOptions = {
  readonly incidents: IncidentJournal
  readonly logger: Logger
  readonly provider: OpenAICompatibleProvider
  readonly getSettings: () => Settings
  readonly getApiKey: () => string
  readonly getTrustedPluginSourceContext: (pluginId: string) => string | undefined
  readonly hasWorkspace: () => boolean
  readonly validateStagedPlugin: (stageId: string) => Promise<unknown>
  readonly onUpdate: () => void
}

export class RepairAgent {
  private unsubscribe: (() => void) | undefined
  private unsubscribeStagedFailures: (() => void) | undefined
  private readonly stagedRepairer: StagedPluginRepairer

  constructor(private readonly options: RepairAgentOptions) {
    this.stagedRepairer = new StagedPluginRepairer({
      provider: options.provider,
      getApiKey: options.getApiKey,
      hasWorkspace: options.hasWorkspace,
      validate: options.validateStagedPlugin,
    })
  }

  start(): void {
    if (this.unsubscribe !== undefined) return
    this.unsubscribe = this.options.incidents.subscribe((incident) => {
      if (!incident.sourceId.startsWith("plugin:")) return
      const pluginId = incident.sourceId.slice("plugin:".length)
      const sourceContext = this.options.getTrustedPluginSourceContext(pluginId)
      void this.diagnose(incident, sourceContext).catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : "UnknownError"
        this.options.logger.error(
          "repair-agent",
          `Diagnose konnte nicht gespeichert werden: ${errorName}`,
        )
      })
    })
  }

  watchStagedRuntime(runtime: StagedPluginRuntime): void {
    if (this.unsubscribeStagedFailures !== undefined) return
    this.unsubscribeStagedFailures = runtime.failures.subscribe((failure) => {
      void this.options.incidents
        .create({
          sourceId: `staged-plugin:${failure.pluginId}`,
          errorName: "PluginRuntimeError",
          severity: "error",
          pluginVersion: failure.version,
          status: "isolated",
        })
        .then(async (incident) => {
          if (!(await this.diagnoseStagedIncident(incident, failure))) return
          await this.repairStagedIncident(incident, failure)
        })
        .catch((error: unknown) => {
          const errorName = error instanceof Error ? error.name : "UnknownError"
          this.options.logger.error(
            "repair-agent",
            `Staging-Diagnose konnte nicht gestartet werden: ${errorName}`,
          )
        })
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.unsubscribeStagedFailures?.()
    this.unsubscribeStagedFailures = undefined
  }

  async diagnoseStagedIncident(
    incident: Incident,
    failure: StagedPluginRuntimeFailure,
  ): Promise<boolean> {
    if (
      incident.sourceId !== `staged-plugin:${failure.pluginId}` ||
      incident.pluginVersion !== failure.version
    ) {
      return false
    }
    return this.diagnose(incident, failure.entrypoint)
  }

  private async repairStagedIncident(
    incident: Incident,
    failure: StagedPluginRuntimeFailure,
  ): Promise<void> {
    await this.options.incidents.updateRepairState(incident.id, "repairing")
    this.options.onUpdate()
    try {
      const result = await this.stagedRepairer.repair(incident, failure, this.options.getSettings())
      switch (result.status) {
        case "staged":
          await this.options.incidents.updateRepairState(
            incident.id,
            "staged",
            "Ein bestätigter Einzelaustausch wurde in Staging übernommen und statisch geprüft. Das Plugin wurde nicht aktiviert.",
          )
          break
        case "cancelled":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_cancelled",
            "Der Reparaturvorschlag wurde nicht angewendet.",
          )
          break
        case "unavailable":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_unavailable",
            "Für diese Reparatur ist eine native App, ein ausgewählter Projektordner und ein lokales Modell erforderlich.",
          )
          break
        case "no_proposal":
          await this.options.incidents.updateRepairState(
            incident.id,
            "diagnosed",
            "Die Diagnose konnte keine ausreichend belegte Einzelkorrektur für Staging ableiten.",
          )
          break
        case "rejected":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_failed",
            "Es konnte keine einzelne statisch akzeptierte Reparatur in Staging erstellt werden.",
          )
          break
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      await this.options.incidents.updateRepairState(
        incident.id,
        "repair_failed",
        "Der begrenzte Reparaturversuch konnte nicht abgeschlossen werden.",
      )
      this.options.logger.warn("repair-agent", `Staging-Reparatur fehlgeschlagen: ${incident.id}`)
    }
    this.options.onUpdate()
  }

  private async diagnose(incident: Incident, sourceContext?: string): Promise<boolean> {
    return diagnoseIncident(this.options, incident, sourceContext)
  }
}
