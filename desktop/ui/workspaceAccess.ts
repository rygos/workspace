import { invoke, isTauri } from "@tauri-apps/api/core"
import type { AppState } from "../core/model"
import type { Persistence } from "../core/persistence"
import { showSaveFeedback } from "./settings"

export type WorkspaceAccessOptions = {
  readonly getState: () => AppState
  readonly setState: (state: AppState) => void
  readonly persistence: Persistence
  readonly refreshPluginPreview: () => Promise<void>
}

export class WorkspaceAccess {
  constructor(private readonly options: WorkspaceAccessOptions) {}

  async select(): Promise<void> {
    if (!isTauri()) return
    const { open } = await import("@tauri-apps/plugin-dialog")
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Projektordner auswählen",
    })
    if (typeof selected !== "string") return
    try {
      const workspaceRoot = await invoke<string>("set_workspace_root", { path: selected })
      const state = { ...this.options.getState(), workspaceRoot }
      this.options.setState(state)
      await this.options.persistence.save(state)
      requiredElement<HTMLElement>("#workspace-root-status").textContent = workspaceRoot
      requiredElement<HTMLButtonElement>("#workspace-clear").hidden = false
      showSaveFeedback("Projektordner freigegeben.")
      await this.options.refreshPluginPreview()
    } catch (error) {
      if (!(error instanceof Error)) throw error
      showSaveFeedback("Der Projektordner konnte nicht freigegeben werden.", true)
    }
  }

  async clear(): Promise<void> {
    if (!isTauri()) return
    await invoke("clear_workspace_root")
    const state = { ...this.options.getState(), workspaceRoot: null }
    this.options.setState(state)
    await this.options.persistence.save(state)
    requiredElement<HTMLElement>("#workspace-root-status").textContent =
      "Kein Projektordner ausgewählt."
    requiredElement<HTMLButtonElement>("#workspace-clear").hidden = true
    showSaveFeedback("Projektordner entfernt.")
    await this.options.refreshPluginPreview()
  }
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return element
}
