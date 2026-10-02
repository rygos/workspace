import { describe, expect, test } from "bun:test"
import type { ZodType } from "zod"
import type { IncidentJournalStorage } from "../core/incidentManager"
import { IncidentJournal } from "../core/incidentManager"
import { Logger } from "../core/logger"
import type { PluginStorageApi } from "../core/persistence"
import { WorkshopPluginHost } from "./host"

function createJournal(): IncidentJournal {
  let persisted: unknown
  const storage: IncidentJournalStorage = {
    read: async () => persisted,
    write: async (state) => {
      persisted = state
    },
  }
  return new IncidentJournal(storage)
}

function memoryStorageFactory(): (pluginId: string) => PluginStorageApi {
  const stores = new Map<string, PluginStorageApi>()
  return (pluginId) => {
    const existing = stores.get(pluginId)
    if (existing !== undefined) return existing
    const values = new Map<string, unknown>()
    const storage: PluginStorageApi = {
      get: async <T>(key: string, schema: ZodType<T>) => {
        const value = values.get(key)
        return value === undefined ? undefined : schema.parse(value)
      },
      set: async <T>(key: string, value: T, schema: ZodType<T>) => {
        values.set(key, schema.parse(value))
      },
      remove: async (key) => {
        values.delete(key)
      },
    }
    stores.set(pluginId, storage)
    return storage
  }
}

describe("workshop plugin host", () => {
  test("discovers, activates, persists, edits and restores the demo notes module", async () => {
    const host = new WorkshopPluginHost({
      storageFor: memoryStorageFactory(),
      incidents: createJournal(),
      logger: new Logger(() => undefined),
    })

    expect(await host.discover()).toBe(0)
    expect((await host.list()).map((plugin) => plugin.status)).toEqual(["discovered"])
    expect(await host.activate("demo-notes")).toBe("active")

    const notes = host.notes()
    const note = await notes?.create("Roadmap auf der Oberfläche bedienen")
    expect(note).toBeDefined()
    if (note === undefined) throw new Error("Die Notes-Capability fehlt nach Aktivierung.")
    await notes?.update(note.id, "Roadmap-Schritt praktisch bedienen")
    await host.markObservedHealthy("demo-notes")
    expect(await host.deactivate("demo-notes")).toBe("disabled")
    expect(host.notes()).toBeUndefined()

    expect(await host.restoreLastKnownGood("demo-notes")).toBe(true)
    expect((await host.list())[0]?.lastKnownGoodVersion).toBe("0.1.0")
    expect((await host.notes()?.list())?.map((saved) => saved.text)).toEqual([
      "Roadmap-Schritt praktisch bedienen",
    ])
  })
})
