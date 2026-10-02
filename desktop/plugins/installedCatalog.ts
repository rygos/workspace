import { z } from "zod"
import { PluginManifestSchema } from "./contracts"
import { validateStagingArtifact } from "./stagingArtifact"

const CATALOG_KEY = "staged-plugin-installs"
const MAX_INSTALLED_PLUGINS = 5
const MAX_CATALOG_BYTES = 2 * 1024 * 1024

const InstalledPluginSchema = z.object({
  sourceStageId: z.string().regex(/^stage-\d+-\d+$/),
  installedAt: z.number().int().nonnegative(),
  manifest: PluginManifestSchema,
  entrypoint: z
    .string()
    .min(1)
    .max(256 * 1024),
})

const InstalledPluginListSchema = z
  .array(InstalledPluginSchema)
  .max(MAX_INSTALLED_PLUGINS)
  .refine(
    (plugins) => new Set(plugins.map((plugin) => plugin.manifest.id)).size === plugins.length,
    "Der installierte Plugin-Katalog enthält doppelte Plugin-IDs.",
  )

export type InstalledStagedPlugin = z.infer<typeof InstalledPluginSchema>

export type ApplicationDataStorage = {
  readonly readApplicationData: <T>(key: string, schema: z.ZodType<T>) => Promise<T | undefined>
  readonly writeApplicationData: <T>(key: string, value: T, schema: z.ZodType<T>) => Promise<void>
}

export class StagedPluginCatalogError extends Error {
  readonly name = "StagedPluginCatalogError"

  constructor(
    readonly code: "invalid_artifact" | "catalog_full" | "storage_limit" | "active_plugin",
    message: string,
  ) {
    super(message)
  }
}

export class StagedPluginCatalog {
  constructor(private readonly storage: ApplicationDataStorage) {}

  async list(): Promise<readonly InstalledStagedPlugin[]> {
    const plugins = await this.storage.readApplicationData(CATALOG_KEY, InstalledPluginListSchema)
    return plugins ?? []
  }

  async find(pluginId: string): Promise<InstalledStagedPlugin | undefined> {
    return (await this.list()).find((plugin) => plugin.manifest.id === pluginId)
  }

  async install(
    sourceStageId: string,
    manifestInput: unknown,
    entrypoint: string,
  ): Promise<InstalledStagedPlugin> {
    const manifest = PluginManifestSchema.parse(manifestInput)
    const report = validateStagingArtifact(sourceStageId, {
      id: sourceStageId,
      manifest: JSON.stringify(manifest),
      entrypoint,
    })
    if (!report.passed) {
      throw new StagedPluginCatalogError(
        "invalid_artifact",
        "Das Plugin kann ohne bestandene Akzeptanzprüfung nicht installiert werden.",
      )
    }

    const installedPlugin = InstalledPluginSchema.parse({
      sourceStageId,
      installedAt: Date.now(),
      manifest,
      entrypoint,
    })
    const current = await this.list()
    const existingIndex = current.findIndex((plugin) => plugin.manifest.id === manifest.id)
    if (existingIndex >= 0) {
      const updated = [...current]
      updated[existingIndex] = installedPlugin
      await this.persist(updated)
      return installedPlugin
    }
    if (current.length >= MAX_INSTALLED_PLUGINS) {
      throw new StagedPluginCatalogError(
        "catalog_full",
        "Es können höchstens fünf Staging-Plugins installiert werden.",
      )
    }
    await this.persist([...current, installedPlugin])
    return installedPlugin
  }

  async uninstall(pluginId: string, activePluginId: string | undefined): Promise<void> {
    if (pluginId === activePluginId) {
      throw new StagedPluginCatalogError(
        "active_plugin",
        "Deaktiviere das Plugin, bevor du es aus der Installation entfernst.",
      )
    }
    const remaining = (await this.list()).filter((plugin) => plugin.manifest.id !== pluginId)
    await this.persist(remaining)
  }

  private async persist(plugins: readonly InstalledStagedPlugin[]): Promise<void> {
    const valid = InstalledPluginListSchema.parse(plugins)
    if (new TextEncoder().encode(JSON.stringify(valid)).byteLength > MAX_CATALOG_BYTES) {
      throw new StagedPluginCatalogError(
        "storage_limit",
        "Der installierte Plugin-Katalog überschreitet das Speicherlimit von 2 MiB.",
      )
    }
    await this.storage.writeApplicationData(CATALOG_KEY, valid, InstalledPluginListSchema)
  }
}
