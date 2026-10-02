import type { IncidentJournal } from "./incidentManager"
import type { Logger } from "./logger"

export type RendererErrorDependencies = {
  readonly incidents: IncidentJournal
  readonly logger: Logger
  readonly setOffline: (message: string) => void
}

export function bindRendererErrorHandlers(dependencies: RendererErrorDependencies): void {
  window.addEventListener("error", (event) => {
    dependencies.logger.error("core", "Ein nicht behandelter Oberflächenfehler wurde abgefangen.")
    recordIncident(dependencies, event.error instanceof Error ? event.error.name : "RendererError")
    dependencies.setOffline("Ein Fehler wurde abgefangen. Der Arbeitsbereich bleibt geöffnet.")
  })
  window.addEventListener("unhandledrejection", (event) => {
    event.preventDefault()
    dependencies.logger.error("core", "Ein nicht behandelter asynchroner Fehler wurde abgefangen.")
    recordIncident(dependencies, event.reason instanceof Error ? event.reason.name : "AsyncError")
    dependencies.setOffline(
      "Ein interner Fehler wurde abgefangen. Der Arbeitsbereich bleibt geöffnet.",
    )
  })
}

export function handleStartupFailure(
  error: unknown,
  root: HTMLElement,
  dependencies: RendererErrorDependencies,
): void {
  root.textContent = "Workshop konnte nicht geöffnet werden. Starte die Anwendung erneut."
  if (!(error instanceof Error)) {
    dependencies.logger.error("startup", "Unbekannter Fehler beim Start.")
    return
  }

  root.dataset["failure"] = error.name
  dependencies.logger.error("startup", error.name)
  recordIncident(dependencies, error.name)
  void dependencies.incidents
    .setSafeMode(true)
    .catch(() =>
      dependencies.logger.error(
        "incident-journal",
        "Sicherer Modus konnte beim Startfehler nicht gesetzt werden.",
      ),
    )
}

function recordIncident(dependencies: RendererErrorDependencies, errorName: string): void {
  void dependencies.incidents
    .create({ sourceId: "core:renderer", errorName, severity: "critical" })
    .catch(() =>
      dependencies.logger.error(
        "incident-journal",
        "Ein Core-Vorfall konnte nicht gespeichert werden.",
      ),
    )
}
