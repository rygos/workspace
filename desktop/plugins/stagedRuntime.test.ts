import { describe, expect, test } from "bun:test"
import { z } from "zod"
import type { PluginStorageApi } from "../core/persistence"
import { validateStagingArtifact } from "./stagingArtifact"
import { TransactionalPluginStorage } from "./transactionalPluginStorage"

describe("staged plugin activation storage", () => {
  test("keeps candidate writes private until startup is accepted", async () => {
    const values = new Map<string, unknown>([["theme", "light"]])
    const storage = new TransactionalPluginStorage(memoryStorage(values))

    await storage.set("theme", "dark", z.string())
    await storage.set("welcome", true, z.boolean())

    expect(values.get("theme")).toBe("light")
    expect(values.has("welcome")).toBe(false)
    expect(await storage.get("theme", z.string())).toBe("dark")

    await storage.commit()
    storage.finalize()
    expect(values.get("theme")).toBe("dark")
    expect(values.get("welcome")).toBe(true)
    await storage.set("theme", "contrast", z.string())
    expect(values.get("theme")).toBe("contrast")
  })

  test("discards writes when candidate activation fails", async () => {
    const values = new Map<string, unknown>([["theme", "light"]])
    const storage = new TransactionalPluginStorage(memoryStorage(values))

    await storage.set("theme", "dark", z.string())
    await storage.remove("legacy")
    await storage.rollback()

    expect(values.get("theme")).toBe("light")
  })

  test("restores committed storage after a finalized plugin later crashes", async () => {
    const values = new Map<string, unknown>([
      ["theme", "light"],
      ["legacy", "keep"],
    ])
    const storage = new TransactionalPluginStorage(memoryStorage(values))

    await storage.set("theme", "dark", z.string())
    await storage.commit()
    storage.finalize()
    expect(values.get("theme")).toBe("dark")
    await storage.set("theme", "contrast", z.string())
    await storage.set("recent", ["workspace"], z.array(z.string()))
    await storage.remove("legacy")
    expect(values.get("theme")).toBe("contrast")
    await storage.rollback()
    expect(values.get("theme")).toBe("light")
    expect(values.has("recent")).toBe(false)
    expect(values.get("legacy")).toBe("keep")
  })

  test("keeps accepted plugin writes after the observation snapshot is released", async () => {
    const values = new Map<string, unknown>([["theme", "light"]])
    const storage = new TransactionalPluginStorage(memoryStorage(values))

    await storage.set("theme", "dark", z.string())
    await storage.commit()
    storage.finalize()
    storage.accept()
    await storage.set("theme", "contrast", z.string())
    await storage.rollback()

    expect(values.get("theme")).toBe("contrast")
  })
})

describe("staging plugin acceptance checks", () => {
  test("accepts a valid bundled storage plugin without executing it", () => {
    const report = validateStagingArtifact("stage-10-2", {
      id: "stage-10-2",
      manifest: JSON.stringify(validManifest()),
      entrypoint:
        'globalThis.WorkshopPlugin = { manifest: { id: "hello-plugin" }, activate() {} };',
    })

    expect(report.passed).toBe(true)
    expect(report.checks.every((check) => check.passed)).toBe(true)
  })

  test("rejects invalid manifests, unsupported permissions and missing bundle exports", () => {
    const manifest = validManifest()
    manifest.permissions = ["events"]
    const report = validateStagingArtifact("stage-10-2", {
      id: "stage-10-2",
      manifest: JSON.stringify(manifest),
      entrypoint: "console.log('not an accepted plugin bundle')",
    })

    expect(report.passed).toBe(false)
    expect(report.checks.find((check) => check.check === "preview_permissions")?.passed).toBe(false)
    expect(report.checks.find((check) => check.check === "bundle_export")?.passed).toBe(false)

    const invalidManifest: Record<string, unknown> = validManifest()
    invalidManifest["apiVersion"] = 9
    const invalidReport = validateStagingArtifact("stage-10-2", {
      id: "stage-10-2",
      manifest: JSON.stringify(invalidManifest),
      entrypoint: "globalThis.WorkshopPlugin = { activate() {} };",
    })
    expect(invalidReport.checks.find((check) => check.check === "manifest_schema")?.passed).toBe(
      false,
    )
  })
})

function memoryStorage(values: Map<string, unknown>): PluginStorageApi {
  return {
    async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
      const value = values.get(key)
      return value === undefined ? undefined : schema.parse(value)
    },
    async set<T>(key: string, value: T, schema: z.ZodType<T>): Promise<void> {
      values.set(key, schema.parse(value))
    },
    async remove(key: string): Promise<void> {
      values.delete(key)
    },
  }
}

function validManifest() {
  return {
    id: "hello-plugin",
    name: "Hello Plugin",
    description: "Acceptance fixture",
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
