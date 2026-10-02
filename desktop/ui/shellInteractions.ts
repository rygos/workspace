import type { ChatController } from "../core/chatController"
import type { PaletteCommand } from "./commands"
import { bindCommandPalette } from "./commands"
import { updateTemperatureLabel } from "./settings"

export type ShellInteractionActions = {
  readonly chat: ChatController
  readonly openSettings: () => void
  readonly retryConnection: () => void
  readonly testSettingsConnection: () => void
  readonly saveSettings: () => Promise<void>
  readonly toggleRail: () => void
  readonly startWorkspace: () => void
  readonly runCommand: (command: PaletteCommand) => void
  readonly setMobileView: (view: "workspace" | "chat") => void
  readonly clearSafeMode: () => Promise<void>
  readonly selectWorkspace: () => Promise<void>
  readonly clearWorkspace: () => Promise<void>
  readonly exportLocalData: () => Promise<void>
}

export function bindShellInteractions(actions: ShellInteractionActions): void {
  requiredElement<HTMLButtonElement>("#settings-open").addEventListener(
    "click",
    actions.openSettings,
  )
  requiredElement<HTMLButtonElement>("#notice-settings").addEventListener(
    "click",
    actions.openSettings,
  )
  requiredElement<HTMLButtonElement>("#provider-retry").addEventListener(
    "click",
    actions.retryConnection,
  )
  requiredElement<HTMLButtonElement>("#settings-retry").addEventListener(
    "click",
    actions.testSettingsConnection,
  )
  requiredElement<HTMLButtonElement>("#rail-toggle").addEventListener("click", actions.toggleRail)
  requiredElement<HTMLButtonElement>("#workspace-start").addEventListener(
    "click",
    actions.startWorkspace,
  )
  requiredElement<HTMLButtonElement>("#chat-clear").addEventListener("click", () =>
    actions.runCommand("clear"),
  )
  requiredElement<HTMLButtonElement>("#chat-stop").addEventListener("click", () =>
    actions.chat.stop(),
  )
  const openCommandPalette = bindCommandPalette(actions.runCommand)

  for (const button of document.querySelectorAll<HTMLButtonElement>(".mobile-tab")) {
    button.addEventListener("click", () => {
      const view = button.dataset["view"]
      if (view === "chat" || view === "workspace") actions.setMobileView(view)
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(".suggestion")) {
    button.addEventListener("click", () => {
      const prompt = button.dataset["prompt"]
      if (prompt === undefined) return
      actions.setMobileView("chat")
      const input = requiredElement<HTMLTextAreaElement>("#chat-input")
      input.value = prompt
      input.focus()
    })
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(".close-dialog")) {
    button.addEventListener("click", () => closeDialog("#settings-dialog"))
  }
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close()
    })
  }

  requiredElement<HTMLInputElement>("#setting-temperature").addEventListener(
    "input",
    updateTemperatureLabel,
  )
  requiredElement<HTMLFormElement>("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault()
    void actions.saveSettings()
  })
  requiredElement<HTMLButtonElement>("#safe-mode-clear").addEventListener(
    "click",
    () => void actions.clearSafeMode(),
  )
  requiredElement<HTMLButtonElement>("#workspace-select").addEventListener(
    "click",
    () => void actions.selectWorkspace(),
  )
  requiredElement<HTMLButtonElement>("#workspace-clear").addEventListener(
    "click",
    () => void actions.clearWorkspace(),
  )
  requiredElement<HTMLButtonElement>("#data-export").addEventListener(
    "click",
    () => void actions.exportLocalData(),
  )

  requiredElement<HTMLFormElement>("#chat-form").addEventListener("submit", (event) => {
    event.preventDefault()
    void actions.chat.send(requiredElement<HTMLTextAreaElement>("#chat-input").value)
  })
  requiredElement<HTMLTextAreaElement>("#chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      requiredElement<HTMLFormElement>("#chat-form").requestSubmit()
    }
  })

  document.addEventListener("keydown", (event) => {
    const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"
    if (isPaletteShortcut) {
      event.preventDefault()
      openCommandPalette()
    } else if (event.key === "Escape") {
      closeDialog("#settings-dialog")
      closeDialog("#command-dialog")
    }
  })
}

function closeDialog(selector: string): void {
  const dialog = document.querySelector<HTMLDialogElement>(selector)
  if (dialog?.open === true) dialog.close()
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return element
}
