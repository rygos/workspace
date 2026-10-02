import type { PluginManifest, PluginStatus } from "../plugins/contracts"
import type { PluginOverview, WorkshopPluginHost } from "../plugins/host"
import { NotesWorkspaceView } from "./notesWorkspace"

const PLUGIN_ACTIONS = ["activate", "deactivate", "healthy", "restore"] as const
type PluginAction = (typeof PLUGIN_ACTIONS)[number]

export class PluginManagerView {
  private readonly list = requiredElement<HTMLOListElement>("#plugin-list")
  private readonly feedback = requiredElement<HTMLElement>("#plugin-feedback")
  private readonly notes: NotesWorkspaceView

  constructor(private readonly host: WorkshopPluginHost) {
    this.notes = new NotesWorkspaceView(host)
  }

  mount(): void {
    this.list.addEventListener("click", (event) => void this.handleAction(event))
    this.notes.mount()
    void this.refresh()
  }

  async refresh(): Promise<void> {
    try {
      const plugins = await this.host.list()
      this.renderPlugins(plugins)
      const notesActive = plugins.some(
        (plugin) => plugin.manifest.id === "demo-notes" && plugin.status === "active",
      )
      await this.notes.render(notesActive)
    } catch (error) {
      this.showError(error)
    }
  }

  private async handleAction(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>("button[data-action]")
    if (button === null) return
    const action = parseAction(button.dataset["action"])
    const pluginId = button.dataset["pluginId"]
    if (action === undefined || pluginId === undefined) return

    button.disabled = true
    this.feedback.textContent = ""
    try {
      const plugin = (await this.host.list()).find(
        (candidate) => candidate.manifest.id === pluginId,
      )
      if (plugin === undefined) throw new Error("Die Erweiterung wurde nicht gefunden.")
      switch (action) {
        case "activate": {
          if (
            !window.confirm(
              `${plugin.manifest.name} (${pluginId}@${plugin.manifest.version}) aktivieren?\n\nBerechtigungen: ${plugin.manifest.permissions.map(permissionLabel).join(", ") || "keine"}.`,
            )
          ) {
            this.feedback.textContent = "Aktivierung abgebrochen."
            break
          }
          const status = await this.host.activate(pluginId)
          this.feedback.textContent =
            status === "active"
              ? "Erweiterung aktiviert."
              : status === "disabled"
                ? "Der sichere Modus verhindert die Aktivierung."
                : status === "quarantined"
                  ? "Die Quarantäne verhindert die Aktivierung. Stelle die Last Known Good-Version wieder her oder warte die Abklingzeit ab."
                  : "Die Erweiterung konnte nicht aktiviert werden."
          break
        }
        case "deactivate": {
          if (!window.confirm(`${plugin.manifest.name} deaktivieren?`)) {
            this.feedback.textContent = "Deaktivierung abgebrochen."
            break
          }
          await this.host.deactivate(pluginId)
          this.feedback.textContent = "Erweiterung deaktiviert."
          break
        }
        case "healthy": {
          if (
            !window.confirm(
              `${plugin.manifest.name} (${plugin.manifest.version}) als Last Known Good speichern? Diese Version wird für die spätere Wiederherstellung vorgemerkt.`,
            )
          ) {
            this.feedback.textContent = "Speichern abgebrochen."
            break
          }
          await this.host.markObservedHealthy(pluginId)
          this.feedback.textContent = "Diese Version ist als Last Known Good gespeichert."
          break
        }
        case "restore": {
          if (!plugin.lastKnownGoodAvailable || plugin.lastKnownGoodVersion === undefined) {
            this.feedback.textContent =
              "Die gespeicherte Last Known Good-Version ist in dieser App-Version nicht verfügbar. Die aktive Erweiterung blieb unverändert."
            break
          }
          if (
            !window.confirm(
              `${plugin.manifest.name} auf Last Known Good ${plugin.lastKnownGoodVersion} zurücksetzen? Die aktuelle Laufzeit wird beendet und die gespeicherte Version erneut aktiviert.`,
            )
          ) {
            this.feedback.textContent = "Wiederherstellung abgebrochen."
            break
          }
          const restored = await this.host.restoreLastKnownGood(pluginId)
          this.feedback.textContent = restored
            ? "Last Known Good wurde aktiviert."
            : "Last Known Good konnte nicht aktiviert werden. Prüfe die Incident-Historie und den Plugin-Status."
          break
        }
        default:
          assertNever(action)
      }
      await this.refresh()
    } catch (error) {
      this.showError(error)
      await this.refresh()
    }
  }

  private renderPlugins(plugins: readonly PluginOverview[]): void {
    this.list.replaceChildren()
    if (plugins.length === 0) {
      const empty = document.createElement("li")
      empty.className = "plugin-list__empty"
      empty.textContent = "Keine Erweiterungsmodule gefunden."
      this.list.append(empty)
      return
    }

    for (const plugin of plugins) {
      const item = document.createElement("li")
      item.className = "plugin-list__item"
      const details = document.createElement("div")
      details.className = "plugin-list__details"
      const name = document.createElement("strong")
      name.textContent = plugin.manifest.name
      const metadata = document.createElement("span")
      const version = plugin.manifest.version
      const healthy = plugin.lastKnownGoodVersion ? ` · LKG ${plugin.lastKnownGoodVersion}` : ""
      const shownStatus = plugin.quarantined ? "quarantined" : plugin.status
      const quarantine = plugin.quarantined
        ? plugin.quarantineExpiresAt === undefined
          ? " · Quarantäne aktiv"
          : ` · Quarantäne bis ${new Date(plugin.quarantineExpiresAt).toLocaleString()}`
        : ""
      metadata.textContent = `${plugin.manifest.id}@${version} · ${statusLabel(shownStatus)}${healthy}${quarantine}`
      const description = document.createElement("span")
      description.textContent = plugin.manifest.description
      const permissions = document.createElement("span")
      permissions.textContent =
        plugin.manifest.permissions.length === 0
          ? "Berechtigungen: keine"
          : `Berechtigungen: ${plugin.manifest.permissions.map(permissionLabel).join(" · ")}`
      details.append(name, metadata, description, permissions)
      if (plugin.lastKnownGoodVersion !== undefined && !plugin.lastKnownGoodAvailable) {
        const recovery = document.createElement("span")
        recovery.textContent = `Last Known Good ${plugin.lastKnownGoodVersion} ist in dieser App-Version nicht verfügbar.`
        details.append(recovery)
      }

      const actions = document.createElement("div")
      actions.className = "plugin-list__actions"
      if (plugin.status === "active") {
        actions.append(
          actionButton("healthy", plugin.manifest.id, "Als LKG speichern"),
          actionButton("deactivate", plugin.manifest.id, "Deaktivieren"),
        )
      } else if (plugin.status !== "quarantined" && !plugin.quarantined) {
        actions.append(actionButton("activate", plugin.manifest.id, "Aktivieren"))
      }
      if (plugin.lastKnownGoodAvailable) {
        actions.append(actionButton("restore", plugin.manifest.id, "LKG wiederherstellen"))
      }
      item.append(details, actions)
      this.list.append(item)
    }
  }

  private showError(error: unknown): void {
    this.feedback.textContent =
      error instanceof Error ? error.message : "Die Erweiterungsaktion ist fehlgeschlagen."
  }
}

function parseAction(value: string | undefined): PluginAction | undefined {
  if (value === undefined) return undefined
  return PLUGIN_ACTIONS.find((action) => action === value)
}

function actionButton(action: PluginAction, pluginId: string, label: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.className = "button button--quiet button--small"
  button.type = "button"
  button.dataset["action"] = action
  button.dataset["pluginId"] = pluginId
  button.textContent = label
  return button
}

function statusLabel(status: PluginStatus): string {
  switch (status) {
    case "discovered":
      return "entdeckt"
    case "validated":
      return "validiert"
    case "loaded":
      return "geladen"
    case "active":
      return "aktiv"
    case "degraded":
      return "eingeschränkt"
    case "failed":
      return "fehlgeschlagen"
    case "quarantined":
      return "quarantänisiert"
    case "disabled":
      return "deaktiviert"
    case "updating":
      return "wird aktualisiert"
    default:
      return assertNever(status)
  }
}

function permissionLabel(permission: PluginManifest["permissions"][number]): string {
  switch (permission) {
    case "storage":
      return "lokaler Speicher"
    case "events":
      return "Ereignisse"
    case "capabilities":
      return "Fähigkeiten"
    default:
      return assertNever(permission)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unerwarteter Erweiterungswert: ${String(value)}`)
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return element
}
