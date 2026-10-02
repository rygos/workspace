import { describe, expect, test } from "bun:test"
import type { IncidentJournalStorage } from "../core/incidentManager"
import { IncidentJournal } from "../core/incidentManager"
import { Logger } from "../core/logger"
import type { PluginModule } from "./loader"
import { PluginLoader } from "./loader"

type Contracts = Record<never, never>
type Event = { readonly type: "demo.ready"; readonly payload: null }

const goodModule: PluginModule<Contracts, Event> = {
  manifest: {
    id: "demo-notes",
    name: "Demo Notes",
    version: "0.1.0",
    apiVersion: 1,
    entrypoint: "index.js",
    permissions: [],
    provides: [],
    consumes: [],
    events: [],
  },
  activate: () => () => undefined,
}

function memoryJournal(): IncidentJournal {
  let persisted: unknown
  const storage: IncidentJournalStorage = {
    read: async () => persisted,
    write: async (value) => {
      persisted = value
    },
  }
  return new IncidentJournal(storage)
}

describe("build-registered plugin loader", () => {
  test("loads only validated modules registered under their manifest id", async () => {
    const loader = new PluginLoader<Contracts, Event>(
      { "demo-notes": async () => goodModule },
      new Logger(() => undefined),
    )

    const result = await loader.discover()

    expect(result.rejected).toBe(0)
    expect(result.definitions.map((definition) => definition.manifest)).toMatchObject([
      { id: "demo-notes", version: "0.1.0" },
    ])
  })

  test("rejects id mismatches and records a safe incident without exposing error details", async () => {
    const journal = memoryJournal()
    const logger = new Logger(() => undefined)
    const loader = new PluginLoader<Contracts, Event>(
      {
        "demo-notes": async () => ({
          ...goodModule,
          manifest: {
            id: "other-plugin",
            name: "Demo Notes",
            version: "0.1.0",
            apiVersion: 1,
            entrypoint: "index.js",
            permissions: [],
            provides: [],
            consumes: [],
            events: [],
          },
        }),
        "failing-plugin": async () => {
          throw new Error("contains a private file path")
        },
      },
      logger,
      journal,
    )

    const result = await loader.discover()
    const incidents = await journal.list()

    expect(result.definitions).toHaveLength(0)
    expect(result.rejected).toBe(2)
    expect(incidents).toHaveLength(2)
    expect(incidents.every((incident) => incident.errorName === "Error")).toBe(true)
    expect(JSON.stringify(incidents)).not.toContain("private file path")
  })
})
