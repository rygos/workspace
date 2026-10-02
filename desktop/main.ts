import { invoke, isTauri } from "@tauri-apps/api/core"
import { RepairAgent } from "./agent/repairAgent"
import { createApplicationServices } from "./core/applicationServices"
import { ChatController } from "./core/chatController"
import { IncidentJournal } from "./core/incidentManager"
import { logger } from "./core/logger"
import type { AppState, Settings } from "./core/model"
import { DEFAULT_APP_STATE } from "./core/model"
import { Persistence, validateLocalDataImport } from "./core/persistence"
import { ProviderError } from "./core/provider"
import { bindRendererErrorHandlers, handleStartupFailure } from "./core/rendererErrors"
import { renderMessages, setConnectionState } from "./ui/chatView"
import { createCommandRunner } from "./ui/commandActions"
import { IncidentHistoryView } from "./ui/incidentHistory"
import { bindResizer } from "./ui/resizer"
import {
  readSettingsForm,
  showSaveFeedback,
  showSettingsDialog,
  updateAvailableModels,
} from "./ui/settings"
import { mountShell } from "./ui/shell"
import { bindShellInteractions } from "./ui/shellInteractions"
import { WorkspaceAccess } from "./ui/workspaceAccess"
import "./styles/app.css"

const root = document.querySelector<HTMLElement>("#app")
if (root === null) throw new Error("Der Anwendungsbereich fehlt.")

mountShell(root)

const persistence = new Persistence()
const incidentJournal = new IncidentJournal()
const incidentHistory = new IncidentHistoryView({ incidents: incidentJournal, logger, element })
let state: AppState = DEFAULT_APP_STATE
let sessionApiKey = ""
let modelIds: readonly string[] = []
const services = createApplicationServices({
  persistence,
  incidents: incidentJournal,
  logger,
  getSettings: () => state.settings,
  getWorkspaceRoot: () => state.workspaceRoot,
  element,
})
const { provider, pluginHost, pluginManager, pluginPreview, stagedPluginRuntime, agentTools } =
  services
const repairAgent = new RepairAgent({
  incidents: incidentJournal,
  logger,
  provider,
  getSettings: () => state.settings,
  getApiKey: () => sessionApiKey,
  getTrustedPluginSourceContext: (pluginId) => pluginHost.diagnosticSourceContext(pluginId),
  hasWorkspace: () => state.workspaceRoot !== null,
  validateStagedPlugin: (stageId) => pluginPreview.validateStagingPlugin(stageId),
  runStagedRegressionTests: (stageId) =>
    invoke<unknown>("validate_staging_copy", { id: stageId, gates: ["test"] }),
  activateStagedRepairCanary: (stageId, pluginId, version) =>
    pluginPreview.activateRepairCanary(stageId, pluginId, version),
  onUpdate: () => {
    void incidentHistory.refresh()
    void pluginManager.refresh()
  },
})
repairAgent.start()
repairAgent.watchStagedRuntime(stagedPluginRuntime)
const workspaceAccess = new WorkspaceAccess({
  getState: () => state,
  setState: (nextState) => {
    state = nextState
  },
  persistence,
  refreshPluginPreview: () => pluginPreview.refresh(),
})
const runCommand = createCommandRunner({
  openSettings,
  retryConnection: () => void checkConnection(),
  clearConversation: () => {
    if (!window.confirm("Die gespeicherte Unterhaltung auf diesem Gerät wirklich leeren?")) return
    updateState({ messages: [] })
    refreshMessages()
  },
  focusChat: () => element<HTMLTextAreaElement>("#chat-input").focus(),
  setMobileView,
})

function element<T extends HTMLElement>(selector: string): T {
  const match = document.querySelector<T>(selector)
  if (match === null) throw new Error(`UI-Element fehlt: ${selector}`)
  return match
}

function updateState(update: Partial<AppState>): void {
  state = { ...state, ...update }
  syncShellState()
  void persistence.save(state)
}

function syncShellState(): void {
  const shell = element<HTMLElement>(".app-shell")
  shell.style.setProperty("--rail-width", `${state.railWidth}px`)
  shell.dataset["collapsed"] = String(state.railCollapsed)
  const toggle = element<HTMLButtonElement>("#rail-toggle")
  toggle.textContent = state.railCollapsed ? "Ausklappen" : "Einklappen"
  toggle.setAttribute(
    "aria-label",
    state.railCollapsed ? "Chatbereich ausklappen" : "Chatbereich einklappen",
  )
  toggle.setAttribute("aria-expanded", String(!state.railCollapsed))
  const resizer = element<HTMLButtonElement>("#rail-resizer")
  resizer.setAttribute("aria-valuenow", String(state.railWidth))
}

function refreshMessages(): void {
  const container = element<HTMLElement>("#message-list")
  renderMessages(container, state.messages)
  element<HTMLElement>("#chat-welcome").hidden = state.messages.length > 0
}

function setMobileView(view: "workspace" | "chat"): void {
  const shell = element<HTMLElement>(".app-shell")
  shell.dataset["mobileView"] = view
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".mobile-tab")) {
    const selected = tab.dataset["view"] === view
    tab.classList.toggle("is-active", selected)
    if (selected) tab.setAttribute("aria-current", "page")
    else tab.removeAttribute("aria-current")
  }
}

async function checkConnection(
  settings: Settings = state.settings,
  apiKey: string = sessionApiKey,
  persistDiscoveredModel = true,
): Promise<void> {
  setConnectionState("checking")
  try {
    modelIds = await provider.discoverModels(settings, apiKey)
    updateAvailableModels(modelIds)
    if (settings.model.length === 0 && modelIds.length > 0) {
      const firstModel = modelIds[0] ?? ""
      if (persistDiscoveredModel) {
        state = {
          ...state,
          settings: { ...settings, model: firstModel },
        }
        await persistence.save(state)
      } else {
        element<HTMLInputElement>("#setting-model").value = firstModel
      }
    }
    setConnectionState("online")
    logger.info("provider", `Modellserver bereit; ${modelIds.length} Modell(e) gefunden.`)
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.message
        : "Der lokale Modellserver konnte nicht erreicht werden. Prüfe die Adresse in den Einstellungen."
    setConnectionState("offline", message)
    logger.warn("provider", error instanceof ProviderError ? error.kind : "connection-error")
  }
}

function openSettings(): void {
  showSettingsDialog(state.settings, sessionApiKey, modelIds, state.workspaceRoot, isTauri())
  void incidentHistory.refresh()
  void pluginManager.refresh()
  void pluginPreview.refresh()
}

function bindEvents(): void {
  const chat = new ChatController({
    provider,
    tools: agentTools,
    persistence,
    getState: () => state,
    setState: (nextState) => {
      state = nextState
    },
    getApiKey: () => sessionApiKey,
    openSettings,
  })
  bindShellInteractions({
    chat,
    openSettings,
    retryConnection: () => void checkConnection(),
    testSettingsConnection,
    saveSettings,
    toggleRail: () => updateState({ railCollapsed: !state.railCollapsed }),
    startWorkspace: () => {
      setMobileView("chat")
      element<HTMLTextAreaElement>("#chat-input").focus()
    },
    runCommand,
    setMobileView,
    clearSafeMode,
    selectWorkspace: () => workspaceAccess.select(),
    clearWorkspace: () => workspaceAccess.clear(),
    exportLocalData: async () => {
      if (
        !window.confirm(
          "Workshop-Einstellungen, Chat-Verlauf und lokale Plugin-Daten als JSON exportieren? Der sitzungsgebundene API-Schlüssel ist nicht enthalten.",
        )
      ) {
        return
      }
      try {
        const data = await persistence.exportLocalData()
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
        )
        const link = document.createElement("a")
        link.href = url
        link.download = `workshop-daten-${new Date().toISOString().slice(0, 10)}.json`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
        showSaveFeedback("Lokale Daten wurden exportiert.")
      } catch (error) {
        showSaveFeedback(
          error instanceof Error ? error.message : "Lokale Daten konnten nicht exportiert werden.",
          true,
        )
      }
    },
    importLocalData: () => {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = "application/json,.json"
      input.addEventListener("change", () => {
        void (async () => {
          const file = input.files?.[0]
          if (file === undefined) return
          try {
            if (file.size > 50 * 1024 * 1024) {
              throw new Error("Die Importdatei überschreitet die Grenze von 50 MiB.")
            }
            const parsed: unknown = JSON.parse(await file.text())
            const data = validateLocalDataImport(parsed)
            if (
              !window.confirm(
                `${file.name} enthält ${data.entries.length} lokale Datensätze. Einstellungen, Chat und Plugin-Daten werden ersetzt. Die Vorfallshistorie bleibt erhalten. Fortfahren?`,
              )
            ) {
              return
            }
            await persistence.importLocalData(data)
            window.location.reload()
          } catch (error) {
            showSaveFeedback(
              error instanceof Error
                ? error.message
                : "Die Daten konnten nicht wiederhergestellt werden.",
              true,
            )
          }
        })()
      })
      input.click()
    },
  })
  bindResizer({
    getWidth: () => state.railWidth,
    setWidth: (railWidth) => updateState({ railWidth: Math.max(300, Math.min(520, railWidth)) }),
  })
}

function testSettingsConnection(): void {
  const result = readSettingsForm()
  if (!result.success) {
    showSaveFeedback(result.message, true)
    return
  }
  void checkConnection(result.data.settings, result.data.apiKey, false)
}

async function saveSettings(): Promise<void> {
  const result = readSettingsForm()
  if (!result.success) {
    showSaveFeedback(result.message, true)
    return
  }
  state = { ...state, settings: result.data.settings }
  sessionApiKey = result.data.apiKey
  await persistence.save(state)
  showSaveFeedback("Gespeichert.")
  await checkConnection()
}

async function clearSafeMode(): Promise<void> {
  if (!window.confirm("Sicheren Modus verlassen und Erweiterungen wieder zulassen?")) return
  await incidentJournal.setSafeMode(false)
  await incidentHistory.refresh()
}

async function start(): Promise<void> {
  state = await persistence.load()
  if (isTauri() && state.workspaceRoot !== null) {
    try {
      const workspaceRoot = await invoke<string>("set_workspace_root", {
        path: state.workspaceRoot,
      })
      state = { ...state, workspaceRoot }
      await persistence.save(state)
    } catch {
      state = { ...state, workspaceRoot: null }
      await persistence.save(state)
    }
  }
  await pluginHost.discover()
  pluginManager.mount()
  pluginPreview.mount()
  syncShellState()
  refreshMessages()
  bindEvents()
  await checkConnection()
}

bindRendererErrorHandlers({
  incidents: incidentJournal,
  logger,
  setOffline: (message) => setConnectionState("offline", message),
})

void start().catch((error: unknown) =>
  handleStartupFailure(error, root, {
    incidents: incidentJournal,
    logger,
    setOffline: (message) => setConnectionState("offline", message),
  }),
)
