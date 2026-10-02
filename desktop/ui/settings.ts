import type { Settings } from "../core/model"
import { SettingsSchema } from "../core/model"

export type SettingsUpdate = {
  readonly settings: Settings
  readonly apiKey: string
}

export function updateAvailableModels(models: readonly string[]): void {
  const list = field<HTMLDataListElement>("#available-models")
  const options = models.map((model) => {
    const option = document.createElement("option")
    option.value = model
    return option
  })
  list.replaceChildren(...options)
}

function field<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`UI-Feld fehlt: ${selector}`)
  return element
}

export function populateSettings(
  settings: Settings,
  apiKey: string,
  models: readonly string[],
): void {
  field<HTMLInputElement>("#setting-url").value = settings.apiBaseUrl
  field<HTMLInputElement>("#setting-model").value = settings.model
  field<HTMLInputElement>("#setting-api-key").value = apiKey
  field<HTMLInputElement>("#setting-temperature").value = String(settings.temperature)
  field<HTMLSelectElement>("#setting-timeout").value = String(settings.timeoutMs)
  field<HTMLSelectElement>("#setting-mode").value = settings.developmentMode
  field<HTMLSelectElement>("#setting-repair-budget").value = String(
    settings.stagedRepairAttemptLimit,
  )

  updateAvailableModels(models)
  updateTemperatureLabel()
}

export function readSettingsForm():
  | { readonly success: true; readonly data: SettingsUpdate }
  | { readonly success: false; readonly message: string } {
  const form = field<HTMLFormElement>("#settings-form")
  const data = new FormData(form)
  const parsed = SettingsSchema.safeParse({
    apiBaseUrl: String(data.get("apiBaseUrl") ?? "").trim(),
    model: String(data.get("model") ?? "").trim(),
    temperature: Number(data.get("temperature")),
    timeoutMs: Number(data.get("timeoutMs")),
    developmentMode: data.get("developmentMode"),
    stagedRepairAttemptLimit: Number(data.get("stagedRepairAttemptLimit")),
  })

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Prüfe die Eingaben." }
  }

  return {
    success: true,
    data: {
      settings: parsed.data,
      apiKey: String(data.get("apiKey") ?? "").trim(),
    },
  }
}

export function showSettingsDialog(
  settings: Settings,
  apiKey: string,
  models: readonly string[],
  workspaceRoot: string | null,
  native: boolean,
): void {
  populateSettings(settings, apiKey, models)
  field<HTMLElement>("#workspace-access-section").hidden = !native
  field<HTMLElement>("#workspace-root-status").textContent =
    workspaceRoot ?? "Kein Projektordner ausgewählt."
  field<HTMLButtonElement>("#workspace-clear").hidden = workspaceRoot === null
  field<HTMLDialogElement>("#settings-dialog").showModal()
}

export function showSaveFeedback(message: string, error = false): void {
  const feedback = field<HTMLElement>("#save-feedback")
  feedback.textContent = message
  feedback.style.color = error ? "var(--status-error)" : "var(--accent)"
}

export function updateTemperatureLabel(): void {
  const input = field<HTMLInputElement>("#setting-temperature")
  const output = field<HTMLOutputElement>("#temperature-value")
  output.value = Number(input.value).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}
