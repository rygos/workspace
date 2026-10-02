import { isTauri } from "@tauri-apps/api/core"
import type { Store } from "@tauri-apps/plugin-store"
import type { ZodType } from "zod"
import type { AppState } from "./model"
import { AppStateSchema, DEFAULT_APP_STATE } from "./model"

const STATE_KEY = "app-state"
const STORE_FILE = "workshop.json"

export class Persistence {
  private readonly nativeStore: Promise<Store | null>

  constructor() {
    this.nativeStore = this.openNativeStore()
  }

  async load(): Promise<AppState> {
    if (isTauri()) {
      const store = await this.nativeStore
      const data = await store?.get<unknown>(STATE_KEY)
      return this.parse(data)
    }

    const saved = window.localStorage.getItem(STATE_KEY)
    if (saved === null) return DEFAULT_APP_STATE

    const result = AppStateSchema.safeParse(JSON.parse(saved) as unknown)
    return result.success ? result.data : DEFAULT_APP_STATE
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

  private parse(data: unknown): AppState {
    const result = AppStateSchema.safeParse(data)
    return result.success ? result.data : DEFAULT_APP_STATE
  }

  private validateApplicationDataKey(key: string): void {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(key)) {
      throw new Error("Ungültiger Schlüssel für Anwendungsdaten.")
    }
  }
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
