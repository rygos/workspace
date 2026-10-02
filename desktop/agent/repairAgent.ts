import type { Incident, IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import type { Settings } from "../core/model"
import type { OpenAICompatibleProvider } from "../core/provider"
import { LifecycleSupervisor, supervisorPolicyFromSettings } from "../plugins/lifecycleSupervisor"
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
  readonly runStagedRegressionTests: (stageId: string) => Promise<unknown>
  readonly activateStagedRepairCanary: (
    stageId: string,
    pluginId: string,
    version: string,
  ) => Promise<"passed" | "failed" | "cancelled" | "busy">
  readonly onUpdate: () => void
}

export class RepairAgent {
  private unsubscribe: (() => void) | undefined
  private unsubscribeStagedFailures: (() => void) | undefined
  private readonly stagedRepairer: StagedPluginRepairer
  private readonly stagedRepairAttempts = new Map<string, number>()
  private readonly supervisor: LifecycleSupervisor

  constructor(private readonly options: RepairAgentOptions) {
    this.supervisor = new LifecycleSupervisor(options.incidents, options.logger, () =>
      supervisorPolicyFromSettings(options.getSettings()),
    )
    this.stagedRepairer = new StagedPluginRepairer({
      provider: options.provider,
      getApiKey: options.getApiKey,
      hasWorkspace: options.hasWorkspace,
      validate: options.validateStagedPlugin,
      runRegressionTests: options.runStagedRegressionTests,
      activateRepairCanary: options.activateStagedRepairCanary,
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
          if (await this.supervisor.recordExistingFailure(failure.pluginId, incident)) {
            runtime.quarantine(failure.pluginId)
            await this.options.incidents.updateRepairState(
              incident.id,
              "repair_unavailable",
              "Wegen wiederholter Laufzeitfehler quarantänisiert. Die Aktivierung und automatische Reparatur sind gesperrt, bis du das Plugin manuell freigibst.",
            )
            this.options.onUpdate()
            return
          }
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
    const settings = this.options.getSettings()
    const usedAttempts = this.stagedRepairAttempts.get(failure.pluginId) ?? 0
    if (usedAttempts >= settings.stagedRepairAttemptLimit) {
      await this.options.incidents.updateRepairState(
        incident.id,
        "repair_unavailable",
        "Das konfigurierte Reparaturlimit für dieses Plugin in dieser App-Sitzung ist erreicht.",
      )
      this.options.onUpdate()
      return
    }
    this.stagedRepairAttempts.set(failure.pluginId, usedAttempts + 1)
    await this.options.incidents.updateRepairState(incident.id, "repairing")
    this.options.onUpdate()
    try {
      const result = await this.stagedRepairer.repair(incident, failure, this.options.getSettings())
      if (result.status === "unavailable") {
        this.stagedRepairAttempts.set(failure.pluginId, usedAttempts)
      }
      switch (result.status) {
        case "staged":
          await this.options.incidents.updateRepairState(
            incident.id,
            "staged",
            "Ein bestätigter Einzelaustausch wurde statisch geprüft und der Regressionstest war erfolgreich. Das Plugin bleibt in Staging und wurde nicht aktiviert.",
          )
          break
        case "canary_passed":
          await this.options.incidents.updateRepairState(
            incident.id,
            "canary_passed",
            "Die bestätigte Reparatur bestand statische Prüfung, Regressionstest und die zehnsekündige Sandbox-Beobachtung.",
          )
          break
        case "canary_failed":
          await this.options.incidents.updateRepairState(
            incident.id,
            "canary_failed",
            "Die Reparatur bestand ihre Canary-Beobachtung nicht. Ein weiterer automatischer Reparaturversuch ist in dieser App-Sitzung gesperrt.",
          )
          break
        case "canary_cancelled":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_canary_cancelled",
            "Die Reparatur blieb in Staging; der Canary wurde nicht gestartet.",
          )
          break
        case "canary_busy":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_canary_busy",
            "Canary nicht gestartet, weil eine andere Plugin-Laufzeit aktiv oder im Wechsel war.",
          )
          break
        case "edit_cancelled":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_cancelled",
            "Der Reparaturvorschlag wurde nicht angewendet.",
          )
          break
        case "tests_cancelled":
          await this.options.incidents.updateRepairState(
            incident.id,
            "repair_test_cancelled",
            "Der Patch liegt in Staging, wurde aber nicht durch Regressionstests validiert.",
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
