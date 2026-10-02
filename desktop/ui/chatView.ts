import type { ChatMessage } from "../core/model"

export function renderMessages(container: HTMLElement, messages: readonly ChatMessage[]): void {
  const fragment = document.createDocumentFragment()
  for (const message of messages) {
    const article = document.createElement("article")
    article.className = `message message--${message.role}`
    article.dataset["messageId"] = message.id

    const label = document.createElement("span")
    label.className = "message__role"
    label.textContent = message.role === "user" ? "DU" : "MODELL"

    const content = document.createElement("p")
    content.className = "message__content"
    content.textContent = message.content
    article.append(label, content)
    fragment.append(article)
  }

  container.replaceChildren(fragment)
  container.scrollTop = container.scrollHeight
}

export function updateMessage(container: HTMLElement, id: string, text: string): void {
  const article = Array.from(container.children).find(
    (element) => element instanceof HTMLElement && element.dataset["messageId"] === id,
  )
  const content = article?.querySelector(".message__content")
  if (content !== null && content !== undefined) content.textContent = text
  container.scrollTop = container.scrollHeight
}

export function setConnectionState(
  state: "checking" | "online" | "offline",
  detail?: string,
): void {
  const pill = document.querySelector<HTMLElement>("#connection-pill")
  const label = document.querySelector<HTMLElement>("#connection-label")
  const notice = document.querySelector<HTMLElement>("#provider-notice")
  const noticeTitle = document.querySelector<HTMLElement>("#provider-notice-title")
  const noticeCopy = document.querySelector<HTMLElement>("#provider-notice-copy")
  const settingsStatus = document.querySelector<HTMLElement>("#settings-connection-status")
  if (
    pill === null ||
    label === null ||
    notice === null ||
    noticeTitle === null ||
    noticeCopy === null
  )
    return

  pill.dataset["state"] = state
  label.textContent =
    state === "checking"
      ? "Verbindung wird geprüft"
      : state === "online"
        ? "Server verbunden"
        : "Server nicht verbunden"
  notice.hidden = state !== "offline"
  noticeTitle.textContent = state === "offline" ? "LM Studio ist nicht erreichbar" : ""
  noticeCopy.textContent =
    detail ?? "Starte den lokalen Server oder prüfe die Verbindungseinstellungen."
  if (settingsStatus !== null) {
    settingsStatus.textContent =
      state === "online"
        ? "Der Modellserver ist erreichbar."
        : state === "checking"
          ? "Verbindung wird geprüft …"
          : (detail ?? "Verbindung noch nicht geprüft.")
  }
}

export function announce(message: string): void {
  const announcer = document.querySelector<HTMLElement>("#announcer")
  if (announcer !== null) announcer.textContent = message
}
