import type { StagedRuntimeState } from "./stagedRuntimeTypes"

export function renderStagedRuntimeState(state: StagedRuntimeState): void {
  const panel = document.querySelector<HTMLElement>("#staged-runtime-panel")
  if (panel !== null) panel.hidden = state.status === "inactive"
  const emptyState = document.querySelector<HTMLElement>("#workspace-empty-state")
  const notesPanel = document.querySelector<HTMLElement>("#demo-notes-panel")
  if (emptyState !== null) {
    emptyState.hidden = state.status === "active" || notesPanel?.hidden === false
  }
  const status = document.querySelector<HTMLElement>("#staged-runtime-status")
  if (status !== null) {
    status.textContent =
      state.status === "active"
        ? `${state.name ?? state.pluginId} · v${state.version} · aktiv`
        : state.status === "failed"
          ? `${state.name ?? state.pluginId} · fehlgeschlagen, Sandbox beendet`
          : state.status === "starting"
            ? `${state.name ?? state.pluginId} · Plugin wird gestartet …`
            : state.status === "reloading"
              ? `${state.name ?? state.pluginId} · Hot Reload wird vorbereitet …`
              : state.status === "recovering"
                ? `${state.name ?? state.pluginId} · vorherige Version wird wiederhergestellt …`
                : state.status === "observing"
                  ? `${state.name ?? state.pluginId} · Canary-Beobachtung (10 s)`
                  : "Keine Staging-Erweiterung aktiv."
  }
  const observing = state.status === "observing"
  const active = state.status === "active" || observing
  const busy =
    state.status === "starting" || state.status === "reloading" || state.status === "recovering"
  const activateButton = document.querySelector<HTMLButtonElement>("#staging-plugin-activate")
  const reloadButton = document.querySelector<HTMLButtonElement>("#staging-plugin-reload")
  const deactivateButton = document.querySelector<HTMLButtonElement>("#staging-plugin-deactivate")
  if (activateButton !== null) activateButton.disabled = active || busy
  if (reloadButton !== null) reloadButton.disabled = state.status !== "active" || busy
  if (deactivateButton !== null) deactivateButton.disabled = !active || busy
}
