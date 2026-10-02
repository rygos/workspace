import { isTauri } from "@tauri-apps/api/core"
import { z } from "zod"
import type { WorkshopPluginHost } from "../plugins/host"
import type { AgentToolBridge, AgentToolDefinition } from "./tools"

const ActivationArgumentsSchema = z
  .object({
    pluginId: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  })
  .strict()

const ActivationResultSchema = z.object({
  pluginId: z.string(),
  status: z.enum([
    "discovered",
    "validated",
    "loaded",
    "active",
    "degraded",
    "failed",
    "quarantined",
    "disabled",
    "updating",
  ]),
})

const definitions: readonly AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "activate_registered_plugin",
      description:
        "Aktiviert nach direkter Nutzerbestätigung ein bereits beim App-Build registriertes und validiertes Plugin. Lädt keinen Code aus einer Staging-Kopie.",
      parameters: {
        type: "object",
        properties: { pluginId: { type: "string", pattern: "^[a-z][a-z0-9-]{1,62}$" } },
        required: ["pluginId"],
        additionalProperties: false,
      },
    },
  },
]

export class PluginActionAgentTools implements AgentToolBridge {
  constructor(
    private readonly host: WorkshopPluginHost,
    private readonly enabled: () => boolean,
  ) {}

  get definitions(): readonly AgentToolDefinition[] {
    return isTauri() && this.enabled() ? definitions : []
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    if (name !== "activate_registered_plugin")
      return json({ error: "Dieses Werkzeug ist nicht verfügbar." })
    if (!isTauri() || !this.enabled()) {
      return json({
        error: "Plugin-Aktivierung ist nur in der nativen App mit lokalem Modell verfügbar.",
      })
    }

    let argumentsValue: unknown
    try {
      argumentsValue = JSON.parse(argumentsJson) as unknown
    } catch {
      return json({ error: "Ungültige Werkzeugargumente." })
    }
    const parsed = ActivationArgumentsSchema.safeParse(argumentsValue)
    if (!parsed.success) return json({ error: "Ungültige Plugin-ID." })

    const { pluginId } = parsed.data
    const plugin = (await this.host.list()).find(({ manifest }) => manifest.id === pluginId)
    if (plugin === undefined) return json({ error: "Das Plugin ist nicht build-registriert." })
    if (plugin.status === "active") return json({ pluginId, status: "active", alreadyActive: true })
    if (plugin.quarantined || plugin.status === "quarantined") {
      return json({ error: "Das Plugin ist quarantänisiert und kann nicht aktiviert werden." })
    }
    if (
      !window.confirm(
        `Das build-registrierte Plugin ${plugin.manifest.name} (${pluginId}@${plugin.manifest.version}) aktivieren? Seine deklarierten Berechtigungen: ${plugin.manifest.permissions.join(", ") || "keine"}.`,
      )
    ) {
      return json({ cancelled: true, message: "Der Nutzer hat die Aktivierung abgebrochen." })
    }

    try {
      const status = await this.host.activate(pluginId)
      return json(ActivationResultSchema.parse({ pluginId, status }))
    } catch {
      return json({ error: "Das registrierte Plugin konnte nicht aktiviert werden." })
    }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}
