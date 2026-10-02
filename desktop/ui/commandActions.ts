import type { PaletteCommand } from "./commands"

export type PaletteCommandActions = {
  readonly openSettings: () => void
  readonly retryConnection: () => void
  readonly clearConversation: () => void
  readonly focusChat: () => void
  readonly setMobileView: (view: "workspace" | "chat") => void
}

export function createCommandRunner(
  actions: PaletteCommandActions,
): (command: PaletteCommand) => void {
  return (command) => {
    closeDialog(document.querySelector<HTMLDialogElement>("#command-dialog"))
    switch (command) {
      case "chat":
        actions.setMobileView("chat")
        actions.focusChat()
        return
      case "settings":
        actions.openSettings()
        return
      case "retry":
        actions.retryConnection()
        return
      case "clear":
        actions.clearConversation()
        return
      default:
        assertNever(command)
    }
  }
}

function closeDialog(dialog: HTMLDialogElement | null): void {
  if (dialog?.open === true) dialog.close()
}

function assertNever(value: never): never {
  throw new Error(`Unbekannter Befehl: ${String(value)}`)
}
