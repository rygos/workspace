type ResizerOptions = {
  readonly getWidth: () => number
  readonly setWidth: (width: number) => void
}

export function bindResizer(options: ResizerOptions): void {
  const resizer = document.querySelector<HTMLButtonElement>("#rail-resizer")
  const shell = document.querySelector<HTMLElement>(".app-shell")
  if (resizer === null || shell === null) throw new Error("Die Chatbreiten-Steuerung fehlt.")

  let resizePointer: number | undefined
  resizer.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 820) return
    resizePointer = event.pointerId
    resizer.setPointerCapture(event.pointerId)
  })
  resizer.addEventListener("pointermove", (event) => {
    if (resizePointer !== event.pointerId) return
    const width = Math.round(Math.max(300, Math.min(520, window.innerWidth - event.clientX)))
    shell.style.setProperty("--rail-width", `${width}px`)
    resizer.setAttribute("aria-valuenow", String(width))
  })

  const finishResize = (event: PointerEvent): void => {
    if (resizePointer !== event.pointerId) return
    resizePointer = undefined
    options.setWidth(Math.round(Math.max(300, Math.min(520, window.innerWidth - event.clientX))))
  }
  resizer.addEventListener("pointerup", finishResize)
  resizer.addEventListener("pointercancel", finishResize)
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 12
    options.setWidth(options.getWidth() + (event.key === "ArrowLeft" ? step : -step))
  })
}
