import { isTauri } from "@tauri-apps/api/core"
import type { Store } from "@tauri-apps/plugin-store"
import type { ZodType } from "zod"
import type { AppState } from "./model"
import { AppStateSchema, DEFAULT_APP_STATE } from "./model"

const STATE_KEY = "app-state"
const RECOVERY_KEY = "app-state-recovery"
const STORE_FILE = "workshop.json"
const EXPORT_VERSION = 1
const MAX_EXPORT_BYTES = 50 * 1024 * 1024

export type ApplicationDataExport = {
  readonly format: "workshop-local-data"
  readonly version: 1
  readonly exportedAt: string
  readonly entries: readonly { readonly key: string; readonly value: unknown }[]
}

export function validateLocalDataImport(value: unknown): ApplicationDataExport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Die Importdatei hat kein gültiges Workshop-Format.")
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate["format"] !== "workshop-local-data" ||
    candidate["version"] !== EXPORT_VERSION ||
    typeof candidate["exportedAt"] !== "string" ||
    !Number.isFinite(Date.parse(candidate["exportedAt"])) ||
    !Array.isArray(candidate["entries"]) ||
    candidate["entries"].length > 5_000
  ) {
    throw new Error(
      "Die Importdatei hat kein gültiges Workshop-Format oder eine nicht unterstützte Version.",
    )
  }

  const seen = new Set<string>()
  const entries = candidate["entries"].map((entry): { key: string; value: unknown } => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Die Importdatei enthält einen ungültigen Datensatz.")
    }
    const record = entry as Record<string, unknown>
    const key = record["key"]
    if (typeof key !== "string" || !isExportableKey(key) || seen.has(key)) {
      throw new Error("Die Importdatei enthält einen ungültigen oder doppelten Speicherschlüssel.")
    }
    seen.add(key)
    return { key, value: record["value"] }
  })
  if (!seen.has(STATE_KEY)) {
    throw new Error("Die Importdatei enthält keinen Anwendungszustand.")
  }
  const state = AppStateSchema.safeParse(entries.find(({ key }) => key === STATE_KEY)?.value)
  if (!state.success) throw new Error("Der Anwendungszustand in der Importdatei ist ungültig.")

  const normalized: ApplicationDataExport = {
    format: "workshop-local-data",
    version: EXPORT_VERSION,
    exportedAt: candidate["exportedAt"],
    entries,
  }
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_EXPORT_BYTES) {
    throw new Error("Die Importdatei überschreitet die Grenze von 50 MiB.")
  }
  return normalized
}

export class Persistence {
  private readonly nativeStore: Promise<Store | null>

  constructor() {
    this.nativeStore = this.openNativeStore()
  }

  async load(): Promise<AppState> {
    if (isTauri()) {
      const store = await this.nativeStore
      const data = await store?.get<unknown>(STATE_KEY)
      return this.parseAndPreserveInvalid(data, async (recovery) => {
        if (store === null || (await store.get(RECOVERY_KEY)) !== undefined) return
        await store.set(RECOVERY_KEY, recovery)
        await store.save()
      })
    }

    const saved = window.localStorage.getItem(STATE_KEY)
    if (saved === null) return DEFAULT_APP_STATE
    let data: unknown
    try {
      data = JSON.parse(saved) as unknown
    } catch {
      data = saved
    }
    return this.parseAndPreserveInvalid(data, (recovery) => {
      if (window.localStorage.getItem(RECOVERY_KEY) === null) {
        window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery))
      }
    })
  }

  async save(state: AppState): Promise<void> {
    const validState = AppStateSchema.parse(state)
    if (isTauri()) {
      const store = await this.nativeStore
      if (store === null) throw new Error("Der lokale Anwendungsspeicher ist nicht verfügbar.")
      await store.set(STATE_KEY, validState)
      await store.save()
      return
    }

    window.localStorage.setItem(STATE_KEY, JSON.stringify(validState))
  }

  async readApplicationData<T>(key: string, schema: ZodType<T>): Promise<T | undefined> {
    this.validateApplicationDataKey(key)
    let value: unknown
    if (isTauri()) {
      value = await (await this.nativeStore)?.get<unknown>(`app:${key}`)
    } else {
      const saved = window.localStorage.getItem(`app:${key}`)
      if (saved === null) return undefined
      try {
        value = JSON.parse(saved) as unknown
      } catch {
        throw new Error(`Gespeicherte Anwendungsdaten sind ungültig: ${key}`)
      }
    }
    return value === undefined ? undefined : schema.parse(value)
  }

  async writeApplicationData<T>(key: string, value: T, schema: ZodType<T>): Promise<void> {
    this.validateApplicationDataKey(key)
    const validValue = schema.parse(value)
    if (isTauri()) {
      const store = await this.nativeStore
      if (store === null) throw new Error("Der lokale Anwendungsspeicher ist nicht verfügbar.")
      await store.set(`app:${key}`, validValue)
      await store.save()
      return
    }
    window.localStorage.setItem(`app:${key}`, JSON.stringify(validValue))
  }

  async exportLocalData(): Promise<ApplicationDataExport> {
    const entries: Array<{ readonly key: string; readonly value: unknown }> = []
    if (isTauri()) {
      const store = await this.nativeStore
      if (store === null) throw new Error("Der lokale Anwendungsspeicher ist nicht verfügbar.")
      for (const [key, value] of await store.entries<unknown>()) {
        if (isExportableKey(key)) entries.push({ key, value })
      }
    } else {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (key === null || !isExportableKey(key)) continue
        const stored = window.localStorage.getItem(key)
        if (stored === null) continue
        try {
          entries.push({ key, value: JSON.parse(stored) as unknown })
        } catch {
          entries.push({ key, value: stored })
        }
      }
    }

    const result: ApplicationDataExport = {
      format: "workshop-local-data",
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      entries,
    }
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_EXPORT_BYTES) {
      throw new Error("Der lokale Datenexport überschreitet die Grenze von 50 MiB.")
    }
    return result
  }

  async importLocalData(input: unknown): Promise<number> {
    const data = validateLocalDataImport(input)
    if (isTauri()) {
      const store = await this.nativeStore
      if (store === null) throw new Error("Der lokale Anwendungsspeicher ist nicht verfügbar.")
      const previous = (await store.entries<unknown>()).filter(([key]) => isExportableKey(key))
      try {
        for (const [key] of previous) await store.delete(key)
        for (const entry of data.entries) await store.set(entry.key, entry.value)
        await store.save()
      } catch (error) {
        for (const [key] of await store.entries<unknown>()) {
          if (isExportableKey(key)) await store.delete(key)
        }
        for (const [key, value] of previous) await store.set(key, value)
        await store.save()
        throw error
      }
      return data.entries.length
    }

    const previous = new Map<string, string>()
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key === null || !isExportableKey(key)) continue
      const value = window.localStorage.getItem(key)
      if (value !== null) previous.set(key, value)
    }
    try {
      for (const key of previous.keys()) window.localStorage.removeItem(key)
      for (const entry of data.entries) {
        window.localStorage.setItem(entry.key, JSON.stringify(entry.value))
      }
    } catch (error) {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index)
        if (key !== null && isExportableKey(key)) window.localStorage.removeItem(key)
      }
      for (const [key, value] of previous) window.localStorage.setItem(key, value)
      throw error
    }
    return data.entries.length
  }

  namespaced(pluginId: string): PluginStorage {
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(pluginId)) {
      throw new Error("Ungültige Plugin-ID für den Speicherbereich.")
    }
    return new PluginStorage(pluginId, this.nativeStore)
  }

  private async openNativeStore(): Promise<Store | null> {
    if (!isTauri()) return null
    const { load } = await import("@tauri-apps/plugin-store")
    return load(STORE_FILE, { autoSave: false })
  }

  private async parseAndPreserveInvalid(
    data: unknown,
    preserve: (recovery: {
      readonly savedAt: string
      readonly data: unknown
    }) => Promise<void> | void,
  ): Promise<AppState> {
    const result = AppStateSchema.safeParse(data)
    if (result.success) return result.data
    if (data !== undefined) {
      await preserve({ savedAt: new Date().toISOString(), data })
    }
    return DEFAULT_APP_STATE
  }

  private validateApplicationDataKey(key: string): void {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(key)) {
      throw new Error("Ungültiger Schlüssel für Anwendungsdaten.")
    }
  }
}

function isExportableKey(key: string): boolean {
  return (
    key === STATE_KEY ||
    key === RECOVERY_KEY ||
    /^app:[a-z][a-z0-9-]{0,62}$/.test(key) ||
    /^plugin:[a-z][a-z0-9-]{1,62}:[a-z][a-z0-9-]{0,62}$/.test(key)
  )
}

export class PluginStorage {
  constructor(
    private readonly pluginId: string,
    private readonly nativeStore: Promise<Store | null>,
  ) {}

  async get<T>(key: string, schema: ZodType<T>): Promise<T | undefined> {
    const storageKey = this.storageKey(key)
    let value: unknown
    if (isTauri()) {
      value = await (await this.nativeStore)?.get<unknown>(storageKey)
    } else {
      const stored = window.localStorage.getItem(storageKey)
      if (stored === null) return undefined
      value = JSON.parse(stored) as unknown
    }
    if (value === undefined) return undefined
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new Error(`Ungültige gespeicherte Plugin-Daten: ${key}`)
    return parsed.data
  }

  async set<T>(key: string, value: T, schema: ZodType<T>): Promise<void> {
    const storageKey = this.storageKey(key)
    const validValue = schema.parse(value)
    if (isTauri()) {
      const store = await this.nativeStore
      if (store === null) throw new Error("Der lokale Anwendungsspeicher ist nicht verfügbar.")
      await store.set(storageKey, validValue)
      await store.save()
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(validValue))
  }

  async remove(key: string): Promise<void> {
    const storageKey = this.storageKey(key)
    if (isTauri()) {
      const store = await this.nativeStore
      if (store === null) throw new Error("Der lokale Anwendungsspeicher ist nicht verfügbar.")
      await store.delete(storageKey)
      await store.save()
      return
    }
    window.localStorage.removeItem(storageKey)
  }

  private storageKey(key: string): string {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(key)) {
      throw new Error("Ungültiger Schlüssel für Plugin-Speicher.")
    }
    return `plugin:${this.pluginId}:${key}`
  }
}

export type PluginStorageApi = {
  readonly get: <T>(key: string, schema: ZodType<T>) => Promise<T | undefined>
  readonly set: <T>(key: string, value: T, schema: ZodType<T>) => Promise<void>
  readonly remove: (key: string) => Promise<void>
}
