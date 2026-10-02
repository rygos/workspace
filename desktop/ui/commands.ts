const COMMANDS = ["chat", "settings", "retry", "clear"] as const
export type PaletteCommand = (typeof COMMANDS)[number]

export function bindCommandPalette(execute: (command: PaletteCommand) => void): () => void {
  const openButton = document.querySelector<HTMLButtonElement>("#command-open")
  const dialog = document.querySelector<HTMLDialogElement>("#command-dialog")
  const input = document.querySelector<HTMLInputElement>("#command-input")
  if (openButton === null || dialog === null || input === null) {
    throw new Error("Die Befehlsübersicht fehlt.")
  }

  const open = (): void => {
    input.value = ""
    for (const item of document.querySelectorAll<HTMLButtonElement>(".command-item"))
      item.hidden = false
    dialog.showModal()
    input.focus()
  }
  openButton.addEventListener("click", open)
  input.addEventListener("input", () => {
    const query = input.value.toLocaleLowerCase("de-DE")
    for (const item of document.querySelectorAll<HTMLButtonElement>(".command-item")) {
      item.hidden = !item.textContent?.toLocaleLowerCase("de-DE").includes(query)
    }
  })
  for (const item of document.querySelectorAll<HTMLButtonElement>(".command-item")) {
    item.addEventListener("click", () => {
      const command = item.dataset["command"]
      const supportedCommand = COMMANDS.find((candidate) => candidate === command)
      if (supportedCommand !== undefined) execute(supportedCommand)
    })
  }
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const visible = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".command-item"),
    ).filter((item) => !item.hidden)
    if (visible.length === 0) return
    const active = document.activeElement
    const currentIndex = active instanceof HTMLButtonElement ? visible.indexOf(active) : -1
    const next =
      currentIndex < 0
        ? event.key === "ArrowDown"
          ? 0
          : visible.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : visible.length - 1)) % visible.length
    visible[next]?.focus()
  })

  return open
}
