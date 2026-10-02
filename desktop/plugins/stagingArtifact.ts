import { z } from "zod"
import { type PluginManifest, PluginManifestSchema } from "./contracts"

const ArtifactSchema = z.object({
  id: z.string().regex(/^stage-\d+-\d+$/),
  manifest: z.string().max(16 * 1024),
  entrypoint: z.string().max(256 * 1024),
})

const ArtifactCheckSchema = z.object({
  check: z.enum(["artifact_pair", "manifest_schema", "preview_permissions", "bundle_export"]),
  passed: z.boolean(),
  message: z.string(),
})
const ArtifactValidationSchema = z.object({
  id: z.string().regex(/^stage-\d+-\d+$/),
  pluginId: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  passed: z.boolean(),
  checks: z.array(ArtifactCheckSchema).length(4),
})

export type PluginArtifactValidation = z.infer<typeof ArtifactValidationSchema>

export function parseStagedPluginManifest(
  manifestInput: unknown,
  entrypoint: string,
): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(manifestInput)
  if (!parsed.success || parsed.data.entrypoint !== "plugin.js") {
    throw new Error("Das Plugin-Manifest ist ungültig.")
  }
  if (parsed.data.permissions.some((permission) => permission !== "storage")) {
    throw new Error(
      "Reguläre Staging-Aktivierung unterstützt derzeit nur storage oder keine Rechte.",
    )
  }
  const bytes = new TextEncoder().encode(entrypoint).byteLength
  if (bytes === 0 || bytes > 256 * 1024)
    throw new Error("Der Plugin-Einstieg überschreitet das Größenlimit.")
  return parsed.data
}

export function validateStagingArtifact(
  id: string,
  artifactInput: unknown,
): PluginArtifactValidation {
  const artifact = ArtifactSchema.parse(artifactInput)
  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(artifact.manifest) as unknown
  } catch {
    rawManifest = undefined
  }
  const parsedManifest = PluginManifestSchema.safeParse(rawManifest)
  const manifest = parsedManifest.success ? parsedManifest.data : undefined
  const entrypointBytes = new TextEncoder().encode(artifact.entrypoint).byteLength
  const permissionsSupported =
    manifest?.permissions.every((permission) => permission === "storage") ?? false
  const hasBundleExport =
    entrypointBytes > 0 &&
    entrypointBytes <= 256 * 1024 &&
    /\bglobalThis\s*\.\s*WorkshopPlugin\s*=/.test(artifact.entrypoint)
  const checks = [
    {
      check: "artifact_pair" as const,
      passed: artifact.id === id,
      message:
        artifact.id === id
          ? "Beide festen Artefaktdateien sind vorhanden und innerhalb der nativen Größenlimits."
          : "Die Artefakt-ID stimmt nicht mit der angeforderten Staging-Kopie überein.",
    },
    {
      check: "manifest_schema" as const,
      passed: manifest !== undefined && manifest.entrypoint === "plugin.js",
      message:
        manifest !== undefined && manifest.entrypoint === "plugin.js"
          ? "Manifest entspricht dem Plugin-Schema und verweist auf plugin.js."
          : "Manifest ist ungültig oder verweist nicht auf plugin.js.",
    },
    {
      check: "preview_permissions" as const,
      passed: permissionsSupported,
      message: permissionsSupported
        ? "Deklarierte Vorschau-Berechtigungen sind unterstützt."
        : "Vorschau unterstützt nur keine Berechtigung oder storage.",
    },
    {
      check: "bundle_export" as const,
      passed: hasBundleExport,
      message: hasBundleExport
        ? "Gebündelter Einstieg enthält den dokumentierten WorkshopPlugin-Export."
        : "Einstieg überschreitet das Größenlimit oder enthält nicht den dokumentierten WorkshopPlugin-Export.",
    },
  ]
  return ArtifactValidationSchema.parse({
    id,
    ...(manifest === undefined
      ? {}
      : { pluginId: manifest.id, name: manifest.name, version: manifest.version }),
    passed: checks.every((check) => check.passed),
    checks,
  })
}
