import type { Incident, IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import type { Settings } from "../core/model"
import type { PluginStatus } from "./contracts"

export type SupervisorPolicy = {
  readonly maxFailures: number
  readonly windowMs: number
}

const DEFAULT_POLICY: SupervisorPolicy = {
  maxFailures: 3,
  windowMs: 30 * 60 * 1000,
}

export function supervisorPolicyFromSettings(
  settings: Pick<Settings, "pluginFailureThreshold" | "pluginFailureWindowMs">,
): SupervisorPolicy {
  return {
    maxFailures: settings.pluginFailureThreshold,
    windowMs: settings.pluginFailureWindowMs,
  }
}

export class LifecycleSupervisor {
  constructor(
    private readonly journal: IncidentJournal,
    private readonly logger: Logger,
    private readonly policy: SupervisorPolicy | (() => SupervisorPolicy) = DEFAULT_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  async blockedStatus(pluginId: string): Promise<PluginStatus | undefined> {
    if (await this.journal.safeMode()) return "disabled"
    return (await this.journal.quarantined(pluginId)) ? "quarantined" : undefined
  }

  async recordFailure(pluginId: string, error: unknown, version: string): Promise<PluginStatus> {
    const errorName = error instanceof Error ? error.name : "UnknownError"
    const stackFrames = errorStackFrames(error)
    const incident = await this.journal.create({
      sourceId: `plugin:${pluginId}`,
      errorName,
      ...(stackFrames === undefined ? {} : { stackFrames }),
      severity: "error",
      pluginVersion: version,
      status: "isolated",
    })
    if (await this.quarantineIfThresholdReached(pluginId, incident)) return "quarantined"

    this.logger.warn("lifecycle-supervisor", `Pluginfehler isoliert: ${pluginId}`)
    return "failed"
  }

  async recordExistingFailure(pluginId: string, incident: Incident): Promise<boolean> {
    return this.quarantineIfThresholdReached(pluginId, incident)
  }

  async recordObservedHealthy(pluginId: string, version: string): Promise<void> {
    await this.journal.recordLastKnownGood(pluginId, version)
    await this.journal.setQuarantined(pluginId, false)
    this.logger.info("lifecycle-supervisor", `Last Known Good gespeichert: ${pluginId}@${version}`)
  }

  async restoreLastKnownGood(
    pluginId: string,
    activateVersion: (version: string) => Promise<void>,
  ): Promise<boolean> {
    const version = await this.journal.lastKnownGood(pluginId)
    if (version === undefined) return false

    try {
      await activateVersion(version)
      await this.journal.setQuarantined(pluginId, false)
      const incidents = await this.journal.list()
      await this.transitionIncidents(incidents, `plugin:${pluginId}`, "restored")
      this.logger.info(
        "lifecycle-supervisor",
        `Last Known Good wiederhergestellt: ${pluginId}@${version}`,
      )
      return true
    } catch {
      this.logger.error(
        "lifecycle-supervisor",
        `Last Known Good konnte nicht aktiviert werden: ${pluginId}`,
      )
      return false
    }
  }

  private async transitionIncidents(
    incidents: readonly Incident[],
    sourceId: string,
    status: "restored",
  ): Promise<void> {
    for (const incident of incidents) {
      if (incident.sourceId === sourceId && incident.status === "quarantined") {
        await this.journal.transition(incident.id, status)
      }
    }
  }

  private async quarantineIfThresholdReached(
    pluginId: string,
    incident: Incident,
  ): Promise<boolean> {
    const policy = typeof this.policy === "function" ? this.policy() : this.policy
    const threshold = this.now() - policy.windowMs
    const attempts = (await this.journal.list()).filter(
      (candidate) =>
        candidate.fingerprint === incident.fingerprint &&
        Date.parse(candidate.createdAt) >= threshold &&
        candidate.status !== "resolved" &&
        candidate.status !== "restored",
    )
    if (attempts.length < policy.maxFailures) return false

    await this.journal.setQuarantined(pluginId, true)
    if (incident.status !== "quarantined") await this.journal.transition(incident.id, "quarantined")
    this.logger.error(
      "lifecycle-supervisor",
      `Plugin wegen wiederholter Fehler quarantänisiert: ${pluginId}`,
    )
    return true
  }
}

function errorStackFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.stack === undefined) return undefined
  const frames = error.stack
    .split(/\r?\n/)
    .slice(1, 13)
    .map((frame) =>
      frame
        .replace(/\bBearer\s+\S+/gi, "Bearer [ENTFERNT]")
        .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[SCHLÜSSEL ENTFERNT]")
        .replace(/([?&](?:token|api[_-]?key|secret|password)=)[^&\s)]+/gi, "$1[ENTFERNT]")
        .slice(0, 512),
    )
    .join("\n")
    .slice(0, 4_096)
  return frames.length > 0 ? frames : undefined
}
