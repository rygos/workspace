import { z } from "zod"
import type { IncidentJournal } from "../core/incidentManager"
import type { Logger } from "../core/logger"
import type { WorkshopPluginHost } from "../plugins/host"

export type AgentToolDefinition = {
  readonly type: "function"
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Readonly<Record<string, unknown>>
  }
}

export type AgentToolBridge = {
  readonly definitions: readonly AgentToolDefinition[]
  execute(name: string, argumentsJson: string): Promise<string>
}

const EmptyArgumentsSchema = z.object({}).strict()
const ReadLogsArgumentsSchema = z
  .object({ limit: z.number().int().min(1).max(25).optional() })
  .strict()

const NO_ARGUMENTS = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const

export class ReadOnlyAgentTools implements AgentToolBridge {
  private readonly appDefinitions: readonly AgentToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "list_plugins",
        description: "Zeigt installierte Erweiterungen und ihren aktuellen Lebenszyklusstatus.",
        parameters: NO_ARGUMENTS,
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_capabilities",
        description:
          "Zeigt Laufzeit- und deklarierte Erweiterungsabhängigkeiten sowie fehlende Versionen und Zyklen.",
        parameters: NO_ARGUMENTS,
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_incidents",
        description: "Zeigt die letzten sicheren Fehler- und Wiederherstellungsvorfälle.",
        parameters: NO_ARGUMENTS,
      },
    },
    {
      type: "function",
      function: {
        name: "read_logs",
        description: "Liest eine begrenzte Anzahl aktueller, strukturierter Anwendungsprotokolle.",
        parameters: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
          required: [],
          additionalProperties: false,
        },
      },
    },
  ]

  constructor(
    private readonly plugins: WorkshopPluginHost,
    private readonly incidents: IncidentJournal,
    private readonly logger: Logger,
    private readonly workspace?: AgentToolBridge,
    private readonly featurePlans?: AgentToolBridge,
    private readonly staging?: AgentToolBridge,
    private readonly pluginActions?: AgentToolBridge,
  ) {}

  get definitions(): readonly AgentToolDefinition[] {
    return [
      ...this.appDefinitions,
      ...(this.workspace?.definitions ?? []),
      ...(this.featurePlans?.definitions ?? []),
      ...(this.staging?.definitions ?? []),
      ...(this.pluginActions?.definitions ?? []),
    ]
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    let rawArguments: unknown
    try {
      rawArguments = JSON.parse(argumentsJson)
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: "Ungültige Werkzeugargumente." })
      throw error
    }

    switch (name) {
      case "list_plugins": {
        if (!EmptyArgumentsSchema.safeParse(rawArguments).success) {
          return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
        }
        const plugins = await this.plugins.list()
        return json(
          plugins.map(({ manifest, status, lastKnownGoodVersion, quarantined }) => ({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            permissions: manifest.permissions,
            status,
            lastKnownGoodVersion: lastKnownGoodVersion ?? null,
            quarantined,
          })),
        )
      }
      case "inspect_capabilities": {
        if (!EmptyArgumentsSchema.safeParse(rawArguments).success) {
          return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
        }
        return json(this.plugins.dependencyGraph())
      }
      case "inspect_incidents": {
        if (!EmptyArgumentsSchema.safeParse(rawArguments).success) {
          return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
        }
        return json(
          (await this.incidents.list())
            .slice(-25)
            .map(
              ({
                id,
                createdAt,
                sourceId,
                fingerprint,
                severity,
                errorName,
                status,
                pluginVersion,
                repair,
              }) => ({
                id,
                createdAt,
                sourceId,
                fingerprint,
                severity,
                errorName,
                status,
                ...(pluginVersion === undefined ? {} : { pluginVersion }),
                ...(repair === undefined ? {} : { repair: { status: repair.status } }),
              }),
            ),
        )
      }
      case "read_logs": {
        const parsed = ReadLogsArgumentsSchema.safeParse(rawArguments)
        if (!parsed.success)
          return json({ error: "Die Protokollgrenze muss zwischen 1 und 25 liegen." })
        const limit = parsed.data.limit ?? 20
        return json(
          this.logger
            .snapshot()
            .slice(-limit)
            .map((record) => ({
              timestamp: record.timestamp,
              level: record.level,
              scope: record.scope,
              message: redact(record.message),
            })),
        )
      }
      default:
        if (this.workspace?.definitions.some((definition) => definition.function.name === name)) {
          return this.workspace.execute(name, argumentsJson)
        }
        if (
          this.featurePlans?.definitions.some((definition) => definition.function.name === name)
        ) {
          return this.featurePlans.execute(name, argumentsJson)
        }
        return (
          (this.pluginActions?.definitions.some((definition) => definition.function.name === name)
            ? this.pluginActions.execute(name, argumentsJson)
            : undefined) ??
          this.staging?.execute(name, argumentsJson) ??
          json({ error: "Dieses Werkzeug ist nicht verfügbar." })
        )
    }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [ENTFERNT]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[SCHLÜSSEL ENTFERNT]")
    .slice(0, 240)
}
