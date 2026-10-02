import { invoke, isTauri } from "@tauri-apps/api/core"
import { z } from "zod"
import type { AgentToolBridge, AgentToolDefinition } from "./tools"

const SearchArgumentsSchema = z
  .object({
    query: z.string().trim().min(2).max(160),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict()
const ReadArgumentsSchema = z.object({ path: z.string().min(1).max(1024) }).strict()
const InspectArgumentsSchema = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict()
const InspectResultSchema = z.object({
  projectName: z.string(),
  filesIndexed: z.number().int(),
  filesReturned: z.number().int(),
  directoriesIndexed: z.number().int(),
  directoriesReturned: z.number().int(),
  directories: z.array(z.string()),
  extensionCounts: z.record(z.string(), z.number().int()),
  files: z.array(z.object({ path: z.string(), extension: z.string() })),
  truncated: z.boolean(),
})
const SearchResultSchema = z.object({
  query: z.string(),
  matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })),
  filesScanned: z.number().int(),
  truncated: z.boolean(),
})
const ReadResultSchema = z.object({ path: z.string(), content: z.string(), truncated: z.boolean() })

const definitions: readonly AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_project",
      description:
        "Zeigt eine begrenzte, maschinenlesbare Übersicht der Ordner und Quelltextdateien im ausgewählten Projekt. Liest keine Datei-Inhalte.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Durchsucht den ausgewählten Projektordner nach Text in Quell- und Dokumentationsdateien. Nur für lokale Modellserver verfügbar.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 160 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Liest eine begrenzte Quell- oder Dokumentationsdatei aus dem ausgewählten Projektordner. Nur für lokale Modellserver verfügbar.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", minLength: 1, maxLength: 1024 } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
]

export class WorkspaceAgentTools implements AgentToolBridge {
  constructor(private readonly enabled: () => boolean) {}

  get definitions(): readonly AgentToolDefinition[] {
    return isTauri() && this.enabled() ? definitions : []
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    if (!isTauri() || !this.enabled())
      return JSON.stringify({
        error:
          "Projektwerkzeuge sind nur mit einem ausgewählten Ordner und lokalem Modellserver verfügbar.",
      })
    let args: unknown
    try {
      args = JSON.parse(argumentsJson) as unknown
    } catch {
      return JSON.stringify({ error: "Ungültige Werkzeugargumente." })
    }
    if (name === "inspect_project") {
      const parsed = InspectArgumentsSchema.safeParse(args)
      if (!parsed.success) return JSON.stringify({ error: "Ungültige Projektübersicht-Optionen." })
      try {
        return JSON.stringify(
          InspectResultSchema.parse(
            await invoke<unknown>("inspect_workspace", { limit: parsed.data.limit ?? 100 }),
          ),
        )
      } catch {
        return JSON.stringify({ error: "Die Projektübersicht konnte nicht erstellt werden." })
      }
    }
    if (name === "search_code") {
      const parsed = SearchArgumentsSchema.safeParse(args)
      if (!parsed.success) return JSON.stringify({ error: "Ungültige Suchanfrage." })
      try {
        const result = SearchResultSchema.parse(
          await invoke<unknown>("search_workspace", {
            query: parsed.data.query,
            limit: parsed.data.limit ?? 10,
          }),
        )
        return JSON.stringify(result)
      } catch {
        return JSON.stringify({
          error: "Die Projektsuche ist fehlgeschlagen oder überschritt ihre Begrenzung.",
        })
      }
    }
    if (name === "read_file") {
      const parsed = ReadArgumentsSchema.safeParse(args)
      if (!parsed.success) return JSON.stringify({ error: "Ungültiger Dateipfad." })
      try {
        return JSON.stringify(
          ReadResultSchema.parse(
            await invoke<unknown>("read_workspace_file", { path: parsed.data.path }),
          ),
        )
      } catch {
        return JSON.stringify({
          error: "Die Datei ist nicht lesbar oder liegt außerhalb des ausgewählten Projektordners.",
        })
      }
    }
    return JSON.stringify({ error: "Dieses Werkzeug ist nicht verfügbar." })
  }
}
