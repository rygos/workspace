import { describe, expect, test } from "bun:test"
import type { ZodType } from "zod"
import type { ApplicationDataStorage } from "./installedCatalog"
import { StagedPluginCatalog, StagedPluginCatalogError } from "./installedCatalog"

describe("persistent staged plugin catalog", () => {
  test("keeps a validated artifact available after its staging source disappears", async () => {
    const data = new Map<string, unknown>()
    const firstSession = new StagedPluginCatalog(memoryApplicationData(data))
    const installed = await firstSession.install("stage-12-4", validManifest(), validEntrypoint())

    const nextSession = new StagedPluginCatalog(memoryApplicationData(data))
    const restored = await nextSession.find(installed.manifest.id)

    expect(restored?.sourceStageId).toBe("stage-12-4")
    expect(restored?.entrypoint).toBe(validEntrypoint())
    expect(restored?.manifest.version).toBe("1.0.0")
  })

  test("refuses artifacts without the accepted bundled export", async () => {
    const catalog = new StagedPluginCatalog(memoryApplicationData(new Map()))

    await expect(
      catalog.install("stage-12-4", validManifest(), "document.body.textContent = 'unsafe';"),
    ).rejects.toBeInstanceOf(StagedPluginCatalogError)
    expect(await catalog.list()).toHaveLength(0)
  })

  test("requires deactivation before removing an installed active plugin", async () => {
    const catalog = new StagedPluginCatalog(memoryApplicationData(new Map()))
    await catalog.install("stage-12-4", validManifest(), validEntrypoint())

    await expect(catalog.uninstall("hello-plugin", "hello-plugin")).rejects.toThrow(
      "Deaktiviere das Plugin",
    )
    expect(await catalog.list()).toHaveLength(1)
    await catalog.uninstall("hello-plugin", undefined)
    expect(await catalog.list()).toHaveLength(0)
  })
})

function memoryApplicationData(values: Map<string, unknown>): ApplicationDataStorage {
  return {
    async readApplicationData<T>(key: string, schema: ZodType<T>): Promise<T | undefined> {
      const value = values.get(key)
      return value === undefined ? undefined : schema.parse(value)
    },
    async writeApplicationData<T>(key: string, value: T, schema: ZodType<T>): Promise<void> {
      values.set(key, schema.parse(value))
    },
  }
}

function validEntrypoint(): string {
  return 'globalThis.WorkshopPlugin = { manifest: { id: "hello-plugin" }, activate() {} };'
}

function validManifest() {
  return {
    id: "hello-plugin",
    name: "Hello Plugin",
    description: "Installed fixture",
    version: "1.0.0",
    apiVersion: 1,
    schemaVersion: 1,
    entrypoint: "plugin.js",
    permissions: ["storage"] as Array<"storage" | "events" | "capabilities">,
    provides: [],
    consumes: [],
    events: [],
    dependencies: [],
    uiContributions: [],
  }
}
