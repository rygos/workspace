import { z } from "zod"

const PluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/)
const ContractNameSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)

export const PluginManifestSchema = z.object({
  id: PluginIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(320).default(""),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-z.-]+)?$/i),
  apiVersion: z.literal(1),
  schemaVersion: z.number().int().min(1).default(1),
  entrypoint: z
    .string()
    .regex(/^[a-zA-Z0-9_./-]+\.js$/)
    .refine(
      (value) => value.split("/").every((segment) => segment !== ".."),
      "Der Einstieg darf das Plugin-Verzeichnis nicht verlassen.",
    ),
  permissions: z
    .array(z.enum(["storage", "events", "capabilities"]))
    .max(8)
    .readonly(),
  provides: z.array(ContractNameSchema).max(64).readonly(),
  consumes: z.array(ContractNameSchema).max(64).readonly(),
  events: z.array(ContractNameSchema).max(64).readonly(),
  dependencies: z
    .array(z.object({ id: PluginIdSchema, version: z.string().min(1).max(80) }))
    .max(32)
    .readonly()
    .default([]),
  uiContributions: z
    .array(z.enum(["workspace", "sidebar", "command", "settings"]))
    .max(32)
    .readonly()
    .default([]),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type PluginStatus =
  | "discovered"
  | "validated"
  | "loaded"
  | "active"
  | "degraded"
  | "failed"
  | "quarantined"
  | "disabled"
  | "updating"

export type WorkshopEvent = {
  readonly type: string
  readonly payload: unknown
}

export type CapabilityEdge = {
  readonly capability: string
  readonly provider: string
  readonly consumer: string
}
