import { z } from "zod"
import type { PluginStorage } from "../core/persistence"
import type { AgentToolBridge, AgentToolDefinition } from "./tools"

const CapabilityNameSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
const FeatureFilePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !/^[a-z]:/i.test(path) &&
      path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "Dateipfade müssen relativ zum Projekt bleiben.",
  )

const FeatureContractInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(10).max(1_000),
    implementationTarget: z.enum(["plugin", "core"]),
    coreRationale: z.string().trim().max(500).optional(),
    requirements: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
    capabilities: z
      .object({
        provides: z.array(CapabilityNameSchema).max(30),
        requires: z.array(CapabilityNameSchema).max(30),
      })
      .strict(),
    permissions: z.array(z.enum(["storage", "events", "capabilities"])).max(3),
    persistence: z
      .object({
        required: z.boolean(),
        description: z.string().trim().min(1).max(500),
      })
      .strict(),
    acceptanceCriteria: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
    implementationSteps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            files: z.array(FeatureFilePathSchema).max(30),
            validation: z.array(z.string().trim().min(1).max(240)).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    risks: z.array(z.string().trim().min(3).max(500)).max(10),
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.implementationTarget === "core" && !contract.coreRationale) {
      context.addIssue({
        code: "custom",
        path: ["coreRationale"],
        message: "Core-Änderungen brauchen eine Begründung.",
      })
    }
    if (
      (contract.capabilities.provides.length > 0 || contract.capabilities.requires.length > 0) &&
      !contract.permissions.includes("capabilities")
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "Capability-Verträge erfordern die capabilities-Berechtigung.",
      })
    }
    if (contract.persistence.required && !contract.permissions.includes("storage")) {
      context.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "Persistente Daten erfordern die storage-Berechtigung.",
      })
    }
  })

const FeaturePlanSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().datetime(),
    status: z.literal("draft"),
    contract: FeatureContractInputSchema,
  })
  .strict()
const StoredPlansSchema = z.array(FeaturePlanSchema).max(30)
const CreateArgumentsSchema = z.object({ contract: FeatureContractInputSchema }).strict()
const ListArgumentsSchema = z.object({}).strict()
const InspectArgumentsSchema = z.object({ id: z.string().uuid() }).strict()

const contractJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    objective: { type: "string", minLength: 10, maxLength: 1000 },
    implementationTarget: { type: "string", enum: ["plugin", "core"] },
    coreRationale: { type: "string", maxLength: 500 },
    requirements: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
    capabilities: {
      type: "object",
      properties: {
        provides: { type: "array", items: { type: "string" }, maxItems: 30 },
        requires: { type: "array", items: { type: "string" }, maxItems: 30 },
      },
      required: ["provides", "requires"],
      additionalProperties: false,
    },
    permissions: {
      type: "array",
      items: { type: "string", enum: ["storage", "events", "capabilities"] },
      maxItems: 3,
    },
    persistence: {
      type: "object",
      properties: {
        required: { type: "boolean" },
        description: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["required", "description"],
      additionalProperties: false,
    },
    acceptanceCriteria: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
    implementationSteps: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          files: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 30 },
          validation: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 10 },
        },
        required: ["title", "files", "validation"],
        additionalProperties: false,
      },
    },
    risks: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: [
    "title",
    "objective",
    "implementationTarget",
    "requirements",
    "capabilities",
    "permissions",
    "persistence",
    "acceptanceCriteria",
    "implementationSteps",
    "risks",
  ],
  additionalProperties: false,
} as const

const definitions: readonly AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_feature_plan",
      description:
        "Erstellt und speichert einen validierten, unverbindlichen Feature-Vertrag samt Umsetzungsschritten. Es werden keine Dateien geändert und keine Freigabe erteilt.",
      parameters: {
        type: "object",
        properties: { contract: contractJsonSchema },
        required: ["contract"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_feature_plans",
      description: "Listet die letzten gespeicherten Feature-Entwürfe auf.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_feature_plan",
      description: "Liest einen gespeicherten Feature-Vertrag samt Plan anhand seiner ID.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", format: "uuid" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
]

export class FeaturePlanAgentTools implements AgentToolBridge {
  constructor(
    private readonly storage: PluginStorage,
    private readonly enabled: () => boolean,
  ) {}

  get definitions(): readonly AgentToolDefinition[] {
    return this.enabled() ? definitions : []
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    if (!this.enabled())
      return json({ error: "Feature-Entwürfe sind nur für lokale Modellserver verfügbar." })
    let raw: unknown
    try {
      raw = JSON.parse(argumentsJson) as unknown
    } catch {
      return json({ error: "Ungültige Werkzeugargumente." })
    }

    if (name === "create_feature_plan") {
      const parsed = CreateArgumentsSchema.safeParse(raw)
      if (!parsed.success)
        return json({
          error: parsed.error.issues[0]?.message ?? "Der Feature-Vertrag ist ungültig.",
        })
      try {
        const plans = await this.plans()
        const plan = FeaturePlanSchema.parse({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          status: "draft",
          contract: parsed.data.contract,
        })
        await this.storage.set("plans", [...plans, plan].slice(-30), StoredPlansSchema)
        return json(plan)
      } catch {
        return json({ error: "Der Feature-Entwurf konnte lokal nicht gespeichert werden." })
      }
    }

    if (name === "list_feature_plans") {
      if (!ListArgumentsSchema.safeParse(raw).success)
        return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
      try {
        const plans = await this.plans()
        return json(
          plans
            .slice(-10)
            .reverse()
            .map(({ id, createdAt, status, contract }) => ({
              id,
              createdAt,
              status,
              title: contract.title,
              objective: contract.objective,
            })),
        )
      } catch {
        return json({ error: "Die gespeicherten Feature-Entwürfe konnten nicht gelesen werden." })
      }
    }

    if (name === "inspect_feature_plan") {
      const parsed = InspectArgumentsSchema.safeParse(raw)
      if (!parsed.success) return json({ error: "Ungültige Entwurfs-ID." })
      try {
        const plan = (await this.plans()).find((entry) => entry.id === parsed.data.id)
        return json(plan ?? { error: "Der Feature-Entwurf wurde nicht gefunden." })
      } catch {
        return json({ error: "Der Feature-Entwurf konnte nicht gelesen werden." })
      }
    }

    return json({ error: "Dieses Werkzeug ist nicht verfügbar." })
  }

  private async plans(): Promise<z.infer<typeof StoredPlansSchema>> {
    return (await this.storage.get("plans", StoredPlansSchema)) ?? []
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}
