import { describe, expect, test } from "bun:test"
import type { z } from "zod"
import { Logger } from "../core/logger"
import type { PluginStorageApi } from "../core/persistence"
import { CapabilityRegistry } from "./capabilityRegistry"
import { type DemoCapabilities, type DemoEvent, demoNotesPlugin } from "./demoNotes"
import { EventBus } from "./eventBus"
import type { PluginDefinition } from "./runtime"
import { PluginRuntime } from "./runtime"

function memoryStorage(): PluginStorageApi {
  const values = new Map<string, unknown>()
  return {
    get: async <T>(key: string, schema: z.ZodType<T>) => {
      const value = values.get(key)
      if (value === undefined) return undefined
      return schema.parse(value)
    },
    set: async <T>(key: string, value: T, schema: z.ZodType<T>) => {
      values.set(key, schema.parse(value))
    },
    remove: async (key) => {
      values.delete(key)
    },
  }
}

describe("plugin runtime foundations", () => {
  test("validates and activates the demo notes plugin with namespaced storage", async () => {
    const capabilities = new CapabilityRegistry<DemoCapabilities>()
    const events = new EventBus<DemoEvent>(() => undefined)
    const runtime = new PluginRuntime(
      capabilities,
      events,
      () => memoryStorage(),
      new Logger(() => undefined),
    )
    const changes: string[] = []
    events.subscribe((event) => {
      if (event.type === "notes.changed") changes.push(String(event.payload.notes.length))
    })

    expect(await runtime.activate(demoNotesPlugin)).toBe("active")
    const notes = capabilities.resolve("notes.v1", "notes-ui")
    expect(notes).toBeDefined()
    const created = await notes?.create("Auf Plugin-Speicher achten")
    expect((await notes?.list())?.map((note) => note.text)).toEqual(["Auf Plugin-Speicher achten"])
    if (created !== undefined) await notes?.update(created.id, "Notiz bearbeiten")
    expect((await notes?.list())?.map((note) => note.text)).toEqual(["Notiz bearbeiten"])
    expect(changes).toEqual(["1", "1"])
    if (created !== undefined) await notes?.remove(created.id)
    expect((await notes?.list()) ?? []).toHaveLength(0)
    expect(changes).toEqual(["1", "1", "0"])
    expect(runtime.status("demo-notes")).toBe("active")
  })

  test("isolates handler failures and permits listener removal", () => {
    type Event = { readonly type: "changed"; readonly payload: { readonly count: number } }
    const failures: string[] = []
    const bus = new EventBus<Event>((event) => failures.push(event.type))
    let handled = 0
    bus.subscribe(() => {
      throw new Error("broken plugin")
    })
    const unsubscribe = bus.subscribe((event) => {
      handled += event.payload.count
    })

    bus.emit({ type: "changed", payload: { count: 2 } })
    unsubscribe()
    bus.emit({ type: "changed", payload: { count: 3 } })

    expect(handled).toBe(2)
    expect(failures).toEqual(["changed", "changed"])
    expect(bus.listenerCount()).toBe(1)
  })

  test("rolls back registered capabilities when activation fails", async () => {
    type Contracts = { "sample.v1": () => string }
    type Event = { readonly type: "sample.event"; readonly payload: string }
    const capabilities = new CapabilityRegistry<Contracts>()
    const runtime = new PluginRuntime(
      capabilities,
      new EventBus<Event>(() => undefined),
      () => memoryStorage(),
      new Logger(() => undefined),
    )
    const plugin: PluginDefinition<Contracts, Event> = {
      manifest: {
        id: "broken-plugin",
        name: "Broken",
        version: "1.0.0",
        apiVersion: 1,
        entrypoint: "index.js",
        permissions: ["capabilities"],
        provides: ["sample.v1"],
        consumes: [],
        events: [],
      },
      activate: ({ capabilities: api }) => {
        api.register("sample.v1", () => "staged")
        throw new Error("activation failed")
      },
    }

    expect(await runtime.activate(plugin)).toBe("failed")
    expect(capabilities.resolve("sample.v1", "test-consumer")).toBeUndefined()
  })

  test("rejects manifest paths that leave the plugin directory", async () => {
    const capabilities = new CapabilityRegistry<DemoCapabilities>()
    const runtime = new PluginRuntime(
      capabilities,
      new EventBus<DemoEvent>(() => undefined),
      () => memoryStorage(),
      new Logger(() => undefined),
    )
    const invalid = {
      manifest: {
        id: "demo-notes",
        name: "Demo Notes",
        version: "0.1.0",
        apiVersion: 1,
        entrypoint: "../outside.js",
        permissions: ["storage", "events", "capabilities"],
        provides: ["notes.v1"],
        consumes: [],
        events: ["notes.changed"],
      },
      activate: demoNotesPlugin.activate,
    }

    await expect(runtime.activate(invalid)).rejects.toThrow("ungültig")
  })

  test("denies capabilities that the manifest did not declare", async () => {
    type Contracts = { "sample.v1": () => string }
    type Event = { readonly type: "sample.event"; readonly payload: string }
    const capabilities = new CapabilityRegistry<Contracts>()
    const runtime = new PluginRuntime(
      capabilities,
      new EventBus<Event>(() => undefined),
      () => memoryStorage(),
      new Logger(() => undefined),
    )
    const plugin: PluginDefinition<Contracts, Event> = {
      manifest: {
        id: "unlisted-provider",
        name: "Unlisted provider",
        version: "1.0.0",
        apiVersion: 1,
        entrypoint: "index.js",
        permissions: ["capabilities"],
        provides: [],
        consumes: [],
        events: [],
      },
      activate: ({ capabilities: api }) => api.register("sample.v1", () => "hidden"),
    }

    expect(await runtime.activate(plugin)).toBe("failed")
    expect(capabilities.resolve("sample.v1", "test-consumer")).toBeUndefined()
  })
})
