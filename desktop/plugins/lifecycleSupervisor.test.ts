import { describe, expect, test } from "bun:test"
import type { ZodType } from "zod"
import type { IncidentJournalStorage } from "../core/incidentManager"
import { IncidentJournal } from "../core/incidentManager"
import { Logger } from "../core/logger"
import type { PluginStorageApi } from "../core/persistence"
import { CapabilityRegistry } from "./capabilityRegistry"
import { EventBus } from "./eventBus"
import { LifecycleSupervisor } from "./lifecycleSupervisor"
import type { PluginDefinition } from "./runtime"
import { PluginRuntime } from "./runtime"

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

function memoryPluginStorage(): PluginStorageApi {
  const values = new Map<string, unknown>()
  return {
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
}

describe("incident journal and lifecycle supervisor", () => {
  test("serializes concurrent writes and keeps error content out of incident records", async () => {
    const journal = createJournal()
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        journal.create({
          sourceId: "core:startup",
          errorName: `Error message included secret ${index}`,
          severity: "error",
        }),
      ),
    )

    const incidents = await journal.list()
    expect(incidents).toHaveLength(20)
    expect(incidents.every((incident) => incident.errorName === "UnknownError")).toBe(true)
    expect(incidents.every((incident) => !incident.fingerprint.includes("secret"))).toBe(true)
  })

  test("quarantines repeated plugin failures and blocks activation", async () => {
    const journal = createJournal()
    const supervisor = new LifecycleSupervisor(journal, new Logger(() => undefined))

    expect(await supervisor.recordFailure("demo-notes", new Error(), "0.1.0")).toBe("failed")
    expect(await supervisor.recordFailure("demo-notes", new Error(), "0.1.0")).toBe("failed")
    expect(await supervisor.recordFailure("demo-notes", new Error(), "0.1.0")).toBe("quarantined")
    expect(await supervisor.blockedStatus("demo-notes")).toBe("quarantined")
    expect(
      (await journal.list()).filter((incident) => incident.status === "quarantined"),
    ).toHaveLength(1)
  })

  test("restores a recorded Last Known Good version and resolves its quarantined incidents", async () => {
    const journal = createJournal()
    const supervisor = new LifecycleSupervisor(journal, new Logger(() => undefined))
    await supervisor.recordObservedHealthy("demo-notes", "0.1.0")
    await supervisor.recordFailure("demo-notes", new Error(), "0.2.0")
    await journal.setQuarantined("demo-notes", true)
    await journal.transition((await journal.list())[0]?.id ?? "", "quarantined")
    let restoredVersion = ""

    const restored = await supervisor.restoreLastKnownGood("demo-notes", async (version) => {
      restoredVersion = version
    })

    expect(restored).toBe(true)
    expect(restoredVersion).toBe("0.1.0")
    expect(await supervisor.blockedStatus("demo-notes")).toBeUndefined()
    expect((await journal.list())[0]?.status).toBe("restored")
  })

  test("safe mode blocks plugins but can be cleared for recovery", async () => {
    const journal = createJournal()
    const supervisor = new LifecycleSupervisor(journal, new Logger(() => undefined))
    await journal.setSafeMode(true)
    expect(await supervisor.blockedStatus("demo-notes")).toBe("disabled")
    await journal.setSafeMode(false)
    expect(await supervisor.blockedStatus("demo-notes")).toBeUndefined()
  })

  test("activation failures reach quarantine through the plugin runtime", async () => {
    type Contracts = Record<never, never>
    type Event = { readonly type: "failure.event"; readonly payload: string }
    const journal = createJournal()
    const supervisor = new LifecycleSupervisor(journal, new Logger(() => undefined))
    const runtime = new PluginRuntime(
      new CapabilityRegistry<Contracts>(),
      new EventBus<Event>(() => undefined),
      () => memoryPluginStorage(),
      new Logger(() => undefined),
      supervisor,
    )
    const lastKnownGood: PluginDefinition<Contracts, Event> = {
      manifest: {
        id: "retry-plugin",
        name: "Retry plugin",
        version: "0.9.0",
        apiVersion: 1,
        entrypoint: "index.js",
        permissions: [],
        provides: [],
        consumes: [],
        events: [],
      },
      activate: () => () => undefined,
    }
    const plugin: PluginDefinition<Contracts, Event> = {
      manifest: {
        id: "retry-plugin",
        name: "Retry plugin",
        version: "1.0.0",
        apiVersion: 1,
        entrypoint: "index.js",
        permissions: [],
        provides: [],
        consumes: [],
        events: [],
      },
      activate: () => {
        throw new Error("sensitive exception detail")
      },
    }

    expect(await runtime.activate(lastKnownGood)).toBe("active")
    await runtime.markObservedHealthy("retry-plugin")
    expect(await runtime.deactivate("retry-plugin")).toBe("disabled")
    expect(await runtime.activate(plugin)).toBe("failed")
    expect(await runtime.activate(plugin)).toBe("failed")
    expect(await runtime.activate(plugin)).toBe("quarantined")
    expect(runtime.status("retry-plugin")).toBe("quarantined")
    expect((await journal.list()).map((incident) => incident.errorName)).toEqual([
      "Error",
      "Error",
      "Error",
    ])

    const restored = await supervisor.restoreLastKnownGood("retry-plugin", async (version) => {
      expect(version).toBe("0.9.0")
      expect(await runtime.activateLastKnownGood(lastKnownGood)).toBe("active")
    })

    expect(restored).toBe(true)
    expect(runtime.status("retry-plugin")).toBe("active")
  })

  test("event handler failures isolate the plugin and record an incident", async () => {
    type Contracts = Record<never, never>
    type Event = { readonly type: "failure.event"; readonly payload: string }
    const journal = createJournal()
    const events = new EventBus<Event>(() => undefined)
    const runtime = new PluginRuntime(
      new CapabilityRegistry<Contracts>(),
      events,
      () => memoryPluginStorage(),
      new Logger(() => undefined),
      new LifecycleSupervisor(journal, new Logger(() => undefined)),
    )
    const plugin: PluginDefinition<Contracts, Event> = {
      manifest: {
        id: "event-failure",
        name: "Event failure",
        version: "1.0.0",
        apiVersion: 1,
        entrypoint: "index.js",
        permissions: ["events"],
        provides: [],
        consumes: [],
        events: ["failure.event"],
      },
      activate: ({ events: api }) => {
        api.subscribe(() => {
          throw new Error("private event detail")
        })
        return () => undefined
      },
    }

    expect(await runtime.activate(plugin)).toBe("active")
    events.emit({ type: "failure.event", payload: "private payload" })
    expect(runtime.status("event-failure")).toBe("failed")
    expect((await journal.list()).map((incident) => incident.sourceId)).toEqual([
      "plugin:event-failure",
    ])
  })
})
