import type { Incident } from "../core/incidentManager"

export function renderIncidentHistory(
  container: HTMLOListElement,
  incidents: readonly Incident[],
): void {
  container.replaceChildren()
  if (incidents.length === 0) {
    const item = document.createElement("li")
    item.className = "incident-list__empty"
    item.textContent = "Noch keine Vorfälle erfasst."
    container.append(item)
    return
  }

  for (const incident of incidents.slice(-8).reverse()) {
    const item = document.createElement("li")
    item.className = "incident-list__item"
    const title = document.createElement("strong")
    title.textContent = `${incident.sourceId} · ${incident.errorName}`
    const meta = document.createElement("span")
    meta.textContent = `${new Date(incident.createdAt).toLocaleString()} · ${statusLabel(incident.status)}`
    item.append(title, meta)
    if (incident.repair !== undefined) {
      const repair = document.createElement("p")
      repair.className = "incident-list__repair"
      const summary = incident.repair.summary
      repair.textContent = `${repairStatusLabel(incident.repair.status)}${summary === undefined ? "" : `: ${summary}`}`
      item.append(repair)
    }
    container.append(item)
  }
}

function repairStatusLabel(status: NonNullable<Incident["repair"]>["status"]): string {
  switch (status) {
    case "queued":
      return "Reparaturdiagnose vorgemerkt"
    case "diagnosing":
      return "Reparaturdiagnose läuft"
    case "diagnosed":
      return "Reparaturdiagnose abgeschlossen"
    case "repairing":
      return "Begrenzte Staging-Reparatur läuft"
    case "staged":
      return "Staging-Reparatur geprüft; Canary nicht abgeschlossen"
    case "canary_passed":
      return "Reparatur-Canary bestanden"
    case "canary_failed":
      return "Reparatur-Canary fehlgeschlagen"
    case "repair_canary_cancelled":
      return "Reparatur-Canary abgebrochen"
    case "repair_canary_busy":
      return "Reparatur-Canary wegen Laufzeitwechsel nicht gestartet"
    case "repair_cancelled":
      return "Staging-Reparatur abgebrochen"
    case "repair_test_cancelled":
      return "Reparatur in Staging; Regressionstest nicht ausgeführt"
    case "repair_unavailable":
      return "Staging-Reparatur nicht verfügbar"
    case "repair_failed":
      return "Staging-Reparatur fehlgeschlagen"
    case "unavailable":
      return "Reparaturdiagnose nicht verfügbar"
    case "failed":
      return "Reparaturdiagnose fehlgeschlagen"
  }
}

function statusLabel(status: Incident["status"]): string {
  switch (status) {
    case "detected":
      return "erkannt"
    case "isolated":
      return "isoliert"
    case "quarantined":
      return "quarantänisiert"
    case "restored":
      return "wiederhergestellt"
    case "resolved":
      return "abgeschlossen"
  }
}
