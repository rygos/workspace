import type { AgentToolBridge } from "../agent/tools"
import { announce, renderMessages, setConnectionState, updateMessage } from "../ui/chatView"
import type { AppState } from "./model"
import { createMessage } from "./model"
import type { Persistence } from "./persistence"
import { type OpenAICompatibleProvider, ProviderError } from "./provider"

type ChatHost = {
  readonly provider: OpenAICompatibleProvider
  readonly tools: AgentToolBridge
  readonly persistence: Persistence
  readonly getState: () => AppState
  readonly setState: (state: AppState) => void
  readonly getApiKey: () => string
  readonly openSettings: () => void
}

const TOOL_ACTIVITY: Readonly<Record<string, string>> = {
  inspect_project: "Projektstruktur wird erfasst …",
  create_feature_plan: "Feature-Vertrag und Plan werden erstellt …",
  list_feature_plans: "Gespeicherte Feature-Entwürfe werden gesucht …",
  inspect_feature_plan: "Feature-Vertrag wird gelesen …",
  create_staging_copy: "Bestätigte Staging-Kopie wird erstellt …",
  list_staging_copies: "Staging-Kopien werden aufgelistet …",
  inspect_staging_diff: "Staging-Kopie wird mit dem Projekt verglichen …",
  apply_staging_edit: "Bestätigte Änderung wird in der Staging-Kopie angewendet …",
  validate_staging_copy: "Bestätigte Prüfungen laufen in der Staging-Kopie …",
  activate_registered_plugin: "Bestätigtes registriertes Plugin wird aktiviert …",
  discard_staging_copy: "Bestätigtes Entfernen der Staging-Kopie …",
  list_plugins: "Erweiterungsstatus wird geprüft …",
  inspect_capabilities: "Erweiterungsfähigkeiten werden geprüft …",
  inspect_incidents: "Vorfälle werden geprüft …",
  read_logs: "Anwendungsprotokolle werden geprüft …",
  search_code: "Projektdateien werden durchsucht …",
  read_file: "Projektdatei wird gelesen …",
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector)
  if (result === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return result
}

export class ChatController {
  private activeRequest: AbortController | undefined

  constructor(private readonly host: ChatHost) {}

  stop(): void {
    this.activeRequest?.abort()
  }

  async send(text: string): Promise<void> {
    const prompt = text.trim()
    const currentState = this.host.getState()
    if (prompt.length === 0 || this.activeRequest !== undefined) return
    if (currentState.settings.model.length === 0) {
      setConnectionState("offline", "Wähle zuerst ein Modell in den Einstellungen.")
      this.host.openSettings()
      return
    }

    const userMessage = createMessage("user", prompt)
    const responseMessage = createMessage("assistant", "")
    const messages = [...currentState.messages, userMessage, responseMessage].slice(-200)
    const nextState: AppState = { ...currentState, messages }
    this.host.setState(nextState)
    await this.host.persistence.save(nextState)
    const list = requiredElement<HTMLElement>("#message-list")
    renderMessages(list, nextState.messages)
    requiredElement<HTMLElement>("#chat-welcome").hidden = true
    requiredElement<HTMLTextAreaElement>("#chat-input").value = ""

    const form = requiredElement<HTMLFormElement>("#chat-form")
    const composerHint = requiredElement<HTMLElement>("#composer-hint")
    const defaultHint = composerHint.textContent ?? ""
    form.setAttribute("aria-busy", "true")
    requiredElement<HTMLButtonElement>("#chat-send").disabled = true
    requiredElement<HTMLButtonElement>("#chat-stop").hidden = false
    const controller = new AbortController()
    this.activeRequest = controller
    let responseText = ""
    setConnectionState("online")

    try {
      const context = nextState.messages.filter((message) => message.content.length > 0).slice(-40)
      await this.host.provider.streamChat(
        {
          settings: nextState.settings,
          apiKey: this.host.getApiKey(),
          messages: context,
          signal: controller.signal,
        },
        {
          tools: this.host.tools,
          onChunk: (chunk) => {
            responseText += chunk
            updateMessage(list, responseMessage.id, responseText)
          },
          onToolCall: (name) => {
            const message = TOOL_ACTIVITY[name] ?? "Anwendungsdaten werden geprüft …"
            composerHint.textContent = message
            announce(message)
          },
        },
      )

      if (responseText.length === 0) responseText = "Das Modell hat eine leere Antwort gesendet."
      await this.saveResponse(responseMessage.id, responseText)
      announce("Die Antwort des Modells ist eingetroffen.")
    } catch (error) {
      if (error instanceof ProviderError && error.kind === "cancelled") {
        responseText =
          responseText.length > 0 ? `${responseText}\n\nAntwort angehalten.` : "Antwort angehalten."
      } else if (error instanceof ProviderError) {
        responseText = error.message
        setConnectionState("offline", error.message)
      } else if (error instanceof Error) {
        responseText = "Die Modellantwort wurde unterbrochen. Du kannst es erneut versuchen."
        setConnectionState("offline", responseText)
      } else {
        throw error
      }
      await this.saveResponse(responseMessage.id, responseText)
    } finally {
      this.activeRequest = undefined
      form.removeAttribute("aria-busy")
      composerHint.textContent = defaultHint
      requiredElement<HTMLButtonElement>("#chat-send").disabled = false
      requiredElement<HTMLButtonElement>("#chat-stop").hidden = true
      const state = this.host.getState()
      renderMessages(list, state.messages)
      requiredElement<HTMLElement>("#chat-welcome").hidden = state.messages.length > 0
    }
  }

  private async saveResponse(id: string, content: string): Promise<void> {
    const currentState = this.host.getState()
    const nextState: AppState = {
      ...currentState,
      messages: currentState.messages.map((message) =>
        message.id === id ? { ...message, content } : message,
      ),
    }
    this.host.setState(nextState)
    await this.host.persistence.save(nextState)
  }
}
