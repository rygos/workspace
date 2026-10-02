import type { Note } from "../plugins/demoNotes"
import type { WorkshopPluginHost } from "../plugins/host"

export class NotesWorkspaceView {
  private editingNoteId: string | undefined
  private readonly panel = requiredElement<HTMLElement>("#demo-notes-panel")
  private readonly emptyState = requiredElement<HTMLElement>("#workspace-empty-state")
  private readonly form = requiredElement<HTMLFormElement>("#note-form")
  private readonly input = requiredElement<HTMLTextAreaElement>("#note-input")
  private readonly submitButton = requiredElement<HTMLButtonElement>("#note-submit")
  private readonly cancelButton = requiredElement<HTMLButtonElement>("#note-cancel")
  private readonly feedback = requiredElement<HTMLElement>("#note-feedback")
  private readonly list = requiredElement<HTMLOListElement>("#note-list")

  constructor(private readonly host: WorkshopPluginHost) {}

  mount(): void {
    this.form.addEventListener("submit", (event) => void this.submit(event))
    this.cancelButton.addEventListener("click", () => this.cancelEdit())
    this.list.addEventListener("click", (event) => void this.handleListAction(event))
  }

  async render(isActive: boolean): Promise<void> {
    const service = isActive ? this.host.notes() : undefined
    const enabled = service !== undefined
    this.panel.hidden = !enabled
    const stagedRuntime = requiredElement<HTMLElement>("#staged-runtime-panel")
    this.emptyState.hidden = enabled || !stagedRuntime.hidden
    if (service === undefined) return

    try {
      this.renderItems(await service.list())
    } catch (error) {
      this.showError(error)
    }
  }

  private async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const text = this.input.value.trim()
    if (text.length === 0) return
    const service = this.host.notes()
    if (service === undefined) return

    this.submitButton.disabled = true
    this.feedback.textContent = ""
    try {
      if (this.editingNoteId === undefined) await service.create(text)
      else await service.update(this.editingNoteId, text)
      this.cancelEdit()
      this.renderItems(await service.list())
    } catch (error) {
      this.showError(error)
    } finally {
      this.submitButton.disabled = false
    }
  }

  private async handleListAction(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>("button[data-action]")
    const action = button?.dataset["action"]
    const noteId = button?.dataset["noteId"]
    if ((action !== "edit" && action !== "delete") || noteId === undefined) return

    const service = this.host.notes()
    if (service === undefined) return
    try {
      const note = (await service.list()).find((candidate) => candidate.id === noteId)
      if (note === undefined) return
      if (action === "edit") {
        this.beginEdit(note)
        return
      }
      if (!window.confirm("Diese Notiz wirklich löschen?")) return
      await service.remove(noteId)
      this.renderItems(await service.list())
      if (this.editingNoteId === noteId) this.cancelEdit()
    } catch (error) {
      this.showError(error)
    }
  }

  private beginEdit(note: Note): void {
    this.editingNoteId = note.id
    this.input.value = note.text
    this.submitButton.textContent = "Änderungen speichern"
    this.cancelButton.hidden = false
    this.input.focus()
    this.input.setSelectionRange(this.input.value.length, this.input.value.length)
  }

  private cancelEdit(): void {
    this.editingNoteId = undefined
    this.input.value = ""
    this.submitButton.textContent = "Notiz speichern"
    this.cancelButton.hidden = true
  }

  private renderItems(notes: readonly Note[]): void {
    this.list.replaceChildren()
    this.feedback.textContent = ""
    if (notes.length === 0) {
      const empty = document.createElement("li")
      empty.className = "note-list__empty"
      empty.textContent = "Noch keine Notizen. Deine erste kann hier beginnen."
      this.list.append(empty)
      return
    }

    for (const note of notes) {
      const item = document.createElement("li")
      item.className = "note-card"
      const content = document.createElement("p")
      content.className = "note-card__content"
      content.textContent = note.text
      const actions = document.createElement("div")
      actions.className = "note-card__actions"
      actions.append(
        actionButton("edit", note.id, "Bearbeiten"),
        actionButton("delete", note.id, "Löschen"),
      )
      item.append(content, actions)
      this.list.append(item)
    }
  }

  private showError(error: unknown): void {
    this.feedback.textContent =
      error instanceof Error ? error.message : "Die Notiz konnte nicht gespeichert werden."
  }
}

function actionButton(action: "edit" | "delete", noteId: string, label: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.className = "button button--quiet button--small"
  button.type = "button"
  button.dataset["action"] = action
  button.dataset["noteId"] = noteId
  button.textContent = label
  return button
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return element
}
