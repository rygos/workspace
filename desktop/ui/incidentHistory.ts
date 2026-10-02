import type { IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import { renderIncidentHistory } from "./incidents"

export type IncidentHistoryOptions = {
  readonly incidents: IncidentJournal
  readonly logger: Logger
  readonly element: <T extends HTMLElement>(selector: string) => T
}

export class IncidentHistoryView {
  constructor(private readonly options: IncidentHistoryOptions) {}

  async refresh(): Promise<void> {
    try {
      const incidents = await this.options.incidents.list()
      renderIncidentHistory(this.options.element<HTMLOListElement>("#incident-list"), incidents)
      const safeMode = await this.options.incidents.safeMode()
      this.options.element<HTMLElement>("#safe-mode-status").hidden = !safeMode
      this.options.element<HTMLButtonElement>("#safe-mode-clear").hidden = !safeMode
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError"
      this.options.logger.error(
        "incident-journal",
        `Der lokale Incident-Verlauf konnte nicht gelesen werden: ${errorName}`,
      )
    }
  }
}
