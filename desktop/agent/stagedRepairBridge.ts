import { invoke } from "@tauri-apps/api/core"
import { z } from "zod"
import type { AgentToolBridge, AgentToolDefinition } from "./tools"

const EditArgumentsSchema = z
  .object({
    expectedContent: z.string().min(1).max(4_096),
    replacement: z.string().min(1).max(4_096),
  })
  .strict()
const EditResultSchema = z.object({
  id: z.string().regex(/^stage-\d+-\d+$/),
  path: z.literal("plugin.js"),
  operation: z.literal("modified"),
  bytesWritten: z.number().int().nonnegative(),
})
const EmptyArgumentsSchema = z.object({}).strict()

const REPAIR_TOOLS: readonly AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "apply_staged_plugin_repair",
      description:
        "Ersetzt genau eine eindeutige Textstelle in plugin.js der gebundenen Staging-Kopie. Workshop zeigt den exakten Austausch und fragt direkt nach Bestätigung. Erstelle keine neue Datei und ändere kein Manifest.",
      parameters: {
        type: "object",
        properties: {
          expectedContent: { type: "string", minLength: 1, maxLength: 4096 },
          replacement: { type: "string", minLength: 1, maxLength: 4096 },
        },
        required: ["expectedContent", "replacement"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_staged_plugin_repair",
      description:
        "Führt nach erfolgreichem Austausch die statische Prüfung des gebundenen Plugin-Artefakts aus. Der Plugin-Code wird nicht ausgeführt.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
]

export type StagedPluginRepairResult =
  | { readonly status: "staged" }
  | { readonly status: "cancelled" }
  | { readonly status: "rejected" }
  | { readonly status: "no_proposal" }
  | { readonly status: "unavailable" }

export class StagedRepairBridge implements AgentToolBridge {
  readonly definitions = REPAIR_TOOLS
  private editAttempted = false
  private editApplied = false
  private validationAttempted = false
  private validationPassed = false
  private cancelled = false

  constructor(
    private readonly stageId: string,
    private readonly pluginId: string,
    private readonly version: string,
    private readonly entrypoint: string,
    private readonly validate: (stageId: string) => Promise<boolean>,
  ) {}

  result(): StagedPluginRepairResult {
    if (this.cancelled) return { status: "cancelled" }
    if (this.editApplied && this.validationPassed) return { status: "staged" }
    if (!this.editAttempted) return { status: "no_proposal" }
    return { status: "rejected" }
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    switch (name) {
      case "apply_staged_plugin_repair":
        return this.apply(argumentsJson)
      case "validate_staged_plugin_repair":
        return this.validateCandidate(argumentsJson)
      default:
        return json({ error: "Dieses Reparaturwerkzeug ist nicht verfügbar." })
    }
  }

  private async apply(argumentsJson: string): Promise<string> {
    if (this.editAttempted)
      return json({ error: "Für diesen Vorfall ist nur ein Austausch erlaubt." })
    this.editAttempted = true
    const parsed = parseArguments(EditArgumentsSchema, argumentsJson)
    if (!parsed.success) return json({ error: "Ungültiger oder zu großer Reparaturvorschlag." })
    const { expectedContent, replacement } = parsed.data
    if (!containsExactlyOnce(this.entrypoint, expectedContent)) {
      return json({ error: "Die vorgeschlagene Textstelle ist nicht eindeutig im Fehlerartefakt." })
    }
    const confirmed = window.confirm(
      `Ein einzelner Reparaturvorschlag für ${this.pluginId}@${this.version} liegt vor.\n\nDatei: plugin.js in Staging-Kopie ${this.stageId}\n\nErsetzen:\n${expectedContent}\n\nDurch:\n${replacement}\n\nNur die Staging-Kopie wird geändert. Der aktive Plugin-Code bleibt unberührt. Fortfahren?`,
    )
    if (!confirmed) {
      this.cancelled = true
      return json({ cancelled: true })
    }
    try {
      const result = EditResultSchema.parse(
        await invoke<unknown>("apply_staging_edit", {
          id: this.stageId,
          path: "plugin.js",
          expectedContent,
          content: replacement,
        }),
      )
      this.editApplied = result.operation === "modified" && result.path === "plugin.js"
      return json(
        this.editApplied ? { applied: true } : { error: "Der Austausch wurde abgelehnt." },
      )
    } catch (error) {
      if (error instanceof Error)
        return json({ error: "Der Austausch konnte nicht angewendet werden." })
      throw error
    }
  }

  private async validateCandidate(argumentsJson: string): Promise<string> {
    if (!EmptyArgumentsSchema.safeParse(parseJson(argumentsJson)).success) {
      return json({ error: "Ungültige Prüfargumente." })
    }
    if (!this.editApplied) return json({ error: "Vor der Prüfung muss ein Austausch gelingen." })
    if (this.validationAttempted)
      return json({ error: "Die statische Prüfung wurde bereits ausgeführt." })
    this.validationAttempted = true
    try {
      this.validationPassed = await this.validate(this.stageId)
      return json({ passed: this.validationPassed, executed: false })
    } catch (error) {
      if (error instanceof Error) return json({ passed: false, executed: false })
      throw error
    }
  }
}

function containsExactlyOnce(source: string, search: string): boolean {
  return source.indexOf(search) !== -1 && source.indexOf(search) === source.lastIndexOf(search)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

function parseArguments<T>(
  schema: z.ZodType<T>,
  value: string,
): { readonly success: true; readonly data: T } | { readonly success: false } {
  const parsed = schema.safeParse(parseJson(value))
  return parsed.success ? parsed : { success: false }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}
