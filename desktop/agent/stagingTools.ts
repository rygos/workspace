import { invoke, isTauri } from "@tauri-apps/api/core"
import { z } from "zod"
import { PluginManifestSchema } from "../plugins/contracts"
import type { PluginArtifactValidation } from "../plugins/stagingArtifact"
import type { PluginPreviewStatus } from "../ui/pluginPreview"
import type { AgentToolBridge, AgentToolDefinition } from "./tools"

const EmptyArgumentsSchema = z.object({}).strict()
const StageIdSchema = z.string().regex(/^stage-\d+-\d+$/)
const StageSchema = z.object({
  id: StageIdSchema,
  projectName: z.string(),
  createdAt: z.number().int().nonnegative(),
  filesCopied: z.number().int().nonnegative(),
  directoriesCopied: z.number().int().nonnegative(),
  bytesCopied: z.number().int().nonnegative(),
  status: z.enum(["complete", "incomplete"]),
})
const DiscardArgumentsSchema = z.object({ id: StageIdSchema }).strict()
const DiffArgumentsSchema = z.object({ id: StageIdSchema }).strict()
const ValidateArgumentsSchema = z
  .object({
    id: StageIdSchema,
    gates: z
      .array(z.enum(["build", "check", "test"]))
      .min(1)
      .max(3),
  })
  .strict()
  .refine(({ gates }) => new Set(gates).size === gates.length)
const EditArgumentsSchema = z
  .object({
    id: StageIdSchema,
    path: z.string().min(1).max(512),
    expectedContent: z
      .string()
      .max(256 * 1024)
      .optional(),
    content: z.string().max(256 * 1024),
  })
  .strict()
const CreatePluginArgumentsSchema = z
  .object({
    id: StageIdSchema,
    manifest: z
      .string()
      .min(1)
      .max(16 * 1024),
    entrypoint: z
      .string()
      .min(1)
      .max(256 * 1024),
  })
  .strict()
const CreatePluginResultSchema = z.object({
  id: StageIdSchema,
  pluginId: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string(),
  version: z.string(),
  manifestBytes: z.number().int().nonnegative(),
  entrypointBytes: z.number().int().nonnegative(),
})
const PreviewArgumentsSchema = z.object({ id: StageIdSchema }).strict()
const PreviewStatusSchema = z.object({
  status: z.enum(["idle", "loading", "running", "failed", "stopped", "cancelled"]),
  pluginId: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
})
const PluginValidationSchema = z.object({
  id: StageIdSchema,
  pluginId: z.string().optional(),
  name: z.string().optional(),
  version: z.string().optional(),
  passed: z.boolean(),
  checks: z
    .array(
      z.object({
        check: z.enum(["artifact_pair", "manifest_schema", "preview_permissions", "bundle_export"]),
        passed: z.boolean(),
        message: z.string(),
      }),
    )
    .length(4),
})
const DiffSchema = z.object({
  id: StageIdSchema,
  projectName: z.string(),
  filesCompared: z.number().int().nonnegative(),
  changeCount: z.number().int().nonnegative(),
  changes: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "modified", "deleted"]),
      sourceBytes: z.number().int().nonnegative().nullable(),
      stagingBytes: z.number().int().nonnegative().nullable(),
    }),
  ),
  truncated: z.boolean(),
})
const EditResultSchema = z.object({
  id: StageIdSchema,
  path: z.string(),
  operation: z.enum(["added", "modified"]),
  bytesWritten: z.number().int().nonnegative(),
})
const ValidationSchema = z.object({
  id: StageIdSchema,
  passed: z.boolean(),
  results: z.array(
    z.object({
      gate: z.enum(["build", "check", "test"]),
      command: z.string(),
      status: z.enum(["passed", "failed", "timed_out"]),
      exitCode: z.number().int().nullable(),
      durationMs: z.number().int().nonnegative(),
      output: z.string().max(8192),
      outputTruncated: z.boolean(),
    }),
  ),
})

const definitions: readonly AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_staging_diff",
      description:
        "Vergleicht eine vollständige Staging-Kopie mit dem weiterhin ausgewählten Quellordner und liefert geänderte Dateipfade und Status.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_staging_edit",
      description:
        "Ändert nach direkter Nutzerbestätigung ausschließlich eine Textdatei in einer vollständigen lokalen Staging-Kopie. Für Änderungen muss expectedContent exakt einmal in der Datei vorkommen; ohne expectedContent wird eine neue Datei angelegt.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" },
          path: { type: "string", minLength: 1, maxLength: 512 },
          expectedContent: { type: "string", maxLength: 262144 },
          content: { type: "string", maxLength: 262144 },
        },
        required: ["id", "path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_staging_copy",
      description:
        "Führt nach Bestätigung ausgewählte feste Bun-Validierungen (build, check, test) in einer vollständigen Staging-Kopie aus. Keine freien Befehle oder Argumente.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" },
          gates: {
            type: "array",
            items: { type: "string", enum: ["build", "check", "test"] },
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
          },
        },
        required: ["id", "gates"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_staging_plugin",
      description:
        "Prüft statisch das feste Plugin-Vorschauartefakt in einer vollständigen Staging-Kopie: Artefaktpaar, Manifest-Schema, unterstützte Rechte und dokumentierten Bundle-Export. Führt den Plugin-Code nicht aus.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preview_staging_plugin",
      description:
        "Öffnet nach direkter Bestätigung des Nutzers ein Plugin aus einer vollständigen Staging-Kopie in der isolierten Vorschau und meldet den tatsächlichen Startstatus. Aktiviert das Plugin nicht.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_staging_plugin_preview",
      description:
        "Liest den aktuellen Lebenszyklusstatus der isolierten Plugin-Vorschau in Workshop-Einstellungen. Gibt keinen Plugin-Code zurück.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_staging_plugin",
      description:
        "Erstellt nach direkter Bestätigung ein neues, festes Plugin-Vorschauartefaktpaar (workshop-plugin.json und plugin.js) in einer vollständigen Staging-Kopie. Überschreibt keine vorhandenen Dateien.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" },
          manifest: { type: "string", minLength: 1, maxLength: 16384 },
          entrypoint: { type: "string", minLength: 1, maxLength: 262144 },
        },
        required: ["id", "manifest", "entrypoint"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_staging_copy",
      description:
        "Erstellt nach Bestätigung durch den Nutzer eine begrenzte Kopie des ausgewählten Projektordners im privaten Anwendungs-Staging. Niemals ohne explizite Bitte, eine Änderung vorzubereiten, aufrufen. Die aktive Projektkopie bleibt unverändert.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_staging_copies",
      description: "Listet vorhandene lokale Staging-Kopien mit Größe und ID auf.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "discard_staging_copy",
      description: "Entfernt nach erneuter Nutzerbestätigung eine angegebene lokale Staging-Kopie.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", pattern: "^stage-[0-9]+-[0-9]+$" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
]

export class StagingAgentTools implements AgentToolBridge {
  constructor(
    private readonly enabled: () => boolean,
    private readonly hasWorkspace: () => boolean,
    private readonly previewStatus: () => PluginPreviewStatus,
    private readonly previewPlugin: (id: string) => Promise<PluginPreviewStatus>,
    private readonly validatePlugin: (id: string) => Promise<PluginArtifactValidation>,
  ) {}

  get definitions(): readonly AgentToolDefinition[] {
    if (!isTauri() || !this.enabled()) return []
    return definitions.filter(
      (definition) =>
        ![
          "create_staging_copy",
          "inspect_staging_diff",
          "apply_staging_edit",
          "create_staging_plugin",
          "inspect_staging_plugin_preview",
          "preview_staging_plugin",
          "validate_staging_plugin",
          "validate_staging_copy",
        ].includes(definition.function.name) || this.hasWorkspace(),
    )
  }

  async execute(name: string, argumentsJson: string): Promise<string> {
    if (!isTauri() || !this.enabled()) {
      return json({
        error: "Staging-Kopien sind nur in der nativen App mit lokalem Modell verfügbar.",
      })
    }
    let argumentsValue: unknown
    try {
      argumentsValue = JSON.parse(argumentsJson) as unknown
    } catch {
      return json({ error: "Ungültige Werkzeugargumente." })
    }

    if (name === "create_staging_copy") {
      if (!this.hasWorkspace()) {
        return json({ error: "Wähle zuerst einen Projektordner aus." })
      }
      if (!EmptyArgumentsSchema.safeParse(argumentsValue).success) {
        return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
      }
      if (
        !window.confirm(
          "Eine begrenzte Kopie des ausgewählten Projektordners im lokalen Staging-Bereich erstellen? Die aktive Projektkopie wird nicht verändert.",
        )
      ) {
        return json({ cancelled: true, message: "Der Nutzer hat die Staging-Kopie abgebrochen." })
      }
      try {
        return json(StageSchema.parse(await invoke<unknown>("create_staging_copy")))
      } catch {
        return json({
          error: "Die Staging-Kopie konnte nicht erstellt werden. Prüfe Größen- und Dateigrenzen.",
        })
      }
    }

    if (name === "inspect_staging_plugin_preview") {
      if (!EmptyArgumentsSchema.safeParse(argumentsValue).success) {
        return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
      }
      if (!this.hasWorkspace()) return json({ error: "Wähle zuerst den Projektordner aus." })
      return json(this.previewStatus())
    }

    if (name === "preview_staging_plugin") {
      const parsed = PreviewArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültige Staging-ID." })
      if (!this.hasWorkspace())
        return json({ error: "Wähle zuerst den ursprünglichen Projektordner aus." })
      try {
        return json(PreviewStatusSchema.parse(await this.previewPlugin(parsed.data.id)))
      } catch {
        return json({ error: "Die Plugin-Vorschau konnte nicht gestartet werden." })
      }
    }

    if (name === "validate_staging_plugin") {
      const parsed = PreviewArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültige Staging-ID." })
      if (!this.hasWorkspace())
        return json({ error: "Wähle zuerst den ursprünglichen Projektordner aus." })
      try {
        return json(PluginValidationSchema.parse(await this.validatePlugin(parsed.data.id)))
      } catch {
        return json({ error: "Das Staging-Plugin konnte nicht statisch geprüft werden." })
      }
    }

    if (name === "list_staging_copies") {
      if (!EmptyArgumentsSchema.safeParse(argumentsValue).success) {
        return json({ error: "Dieses Werkzeug erwartet keine Argumente." })
      }
      try {
        return json(
          z
            .array(StageSchema)
            .max(5)
            .parse(await invoke<unknown>("list_staging_copies")),
        )
      } catch {
        return json({ error: "Die lokalen Staging-Kopien konnten nicht gelesen werden." })
      }
    }

    if (name === "inspect_staging_diff") {
      const parsed = DiffArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültige Staging-ID." })
      if (!this.hasWorkspace())
        return json({ error: "Wähle den ursprünglichen Projektordner aus." })
      try {
        return json(
          DiffSchema.parse(await invoke<unknown>("inspect_staging_diff", { id: parsed.data.id })),
        )
      } catch {
        return json({
          error:
            "Der Staging-Diff konnte nicht erstellt werden. Prüfe den ausgewählten Projektordner und die Dateigrenzen.",
        })
      }
    }

    if (name === "create_staging_plugin") {
      const parsed = CreatePluginArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültiger Plugin-Artefaktauftrag." })
      if (!this.hasWorkspace())
        return json({ error: "Wähle zuerst den ursprünglichen Projektordner aus." })
      let manifestValue: unknown
      try {
        manifestValue = JSON.parse(parsed.data.manifest) as unknown
      } catch {
        return json({ error: "Das Plugin-Manifest ist kein gültiges JSON." })
      }
      const manifest = PluginManifestSchema.safeParse(manifestValue)
      if (!manifest.success || manifest.data.entrypoint !== "plugin.js") {
        return json({
          error: "Das Manifest muss dem Plugin-Schema entsprechen und plugin.js nutzen.",
        })
      }
      if (manifest.data.permissions.some((permission) => permission !== "storage")) {
        return json({
          error: "Die Vorschau unterstützt derzeit nur keine Berechtigung oder storage.",
        })
      }
      const manifestText = JSON.stringify(manifest.data)
      const manifestBytes = new TextEncoder().encode(manifestText).byteLength
      const entrypointBytes = new TextEncoder().encode(parsed.data.entrypoint).byteLength
      if (manifestBytes > 16 * 1024 || entrypointBytes > 256 * 1024) {
        return json({ error: "Das Plugin-Artefakt überschreitet die Größenlimits." })
      }
      const confirmed = window.confirm(
        `Plugin-Artefakt in Staging-Kopie ${parsed.data.id} anlegen?\n\n${manifest.data.name} (${manifest.data.id}) v${manifest.data.version}\nBerechtigungen: ${manifest.data.permissions.join(", ") || "keine"}\nEinstieg: plugin.js (${entrypointBytes} Bytes)\n\nDie Dateien werden nur in der Staging-Kopie angelegt und nicht überschrieben. Beim späteren Öffnen der Vorschau wird der Plugin-Code ausgeführt.`,
      )
      if (!confirmed)
        return json({ cancelled: true, message: "Der Nutzer hat das Plugin-Artefakt abgebrochen." })
      try {
        return json(
          CreatePluginResultSchema.parse(
            await invoke<unknown>("create_staging_plugin", {
              id: parsed.data.id,
              manifest: manifestText,
              entrypoint: parsed.data.entrypoint,
            }),
          ),
        )
      } catch {
        return json({
          error:
            "Das Plugin-Artefakt konnte nicht angelegt werden. Prüfe Staging-ID und Dateigrenzen.",
        })
      }
    }

    if (name === "apply_staging_edit") {
      const parsed = EditArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültiger Staging-Dateiänderungsauftrag." })
      if (!this.hasWorkspace())
        return json({ error: "Wähle zuerst den ursprünglichen Projektordner aus." })
      const { id, path, expectedContent, content } = parsed.data
      const action = expectedContent === undefined ? "Neue Datei anlegen" : "Dateiänderung anwenden"
      if (
        !window.confirm(
          `${action} in ${path} innerhalb der Staging-Kopie ${id}? Der ausgewählte Projektordner wird nicht geändert.`,
        )
      ) {
        return json({
          cancelled: true,
          message: "Der Nutzer hat die Staging-Änderung abgebrochen.",
        })
      }
      try {
        return json(
          EditResultSchema.parse(
            await invoke<unknown>("apply_staging_edit", {
              id,
              path,
              expectedContent: expectedContent ?? null,
              content,
            }),
          ),
        )
      } catch {
        return json({
          error:
            "Die Staging-Datei konnte nicht geändert werden. Prüfe Pfad, Textstelle und Dateigrenzen.",
        })
      }
    }

    if (name === "validate_staging_copy") {
      const parsed = ValidateArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültige Validierungsauswahl." })
      if (!this.hasWorkspace())
        return json({ error: "Wähle zuerst den ursprünglichen Projektordner aus." })
      const { id, gates } = parsed.data
      const commands = gates.map((gate) => (gate === "test" ? "bun test" : `bun run ${gate}`))
      const confirmed = window.confirm(
        `Diese Validierungen führen Projekt-Skripte aus der Staging-Kopie aus. Der Code kann auch auf andere lokale Dateien und das Netzwerk zugreifen.\n\n${commands.join("\n")}\n\nFortfahren? Die ausgewählte Projektquelle wird nicht als Arbeitsverzeichnis verwendet.`,
      )
      if (!confirmed)
        return json({ cancelled: true, message: "Der Nutzer hat die Validierung abgebrochen." })
      try {
        return json(
          ValidationSchema.parse(await invoke<unknown>("validate_staging_copy", { id, gates })),
        )
      } catch {
        return json({
          error:
            "Die Staging-Validierung konnte nicht gestartet werden. Prüfe Bun, package.json und den ausgewählten Quellordner.",
        })
      }
    }

    if (name === "discard_staging_copy") {
      const parsed = DiscardArgumentsSchema.safeParse(argumentsValue)
      if (!parsed.success) return json({ error: "Ungültige Staging-ID." })
      if (!window.confirm(`Staging-Kopie ${parsed.data.id} endgültig entfernen?`)) {
        return json({ cancelled: true, message: "Der Nutzer hat das Entfernen abgebrochen." })
      }
      try {
        await invoke("discard_staging_copy", { id: parsed.data.id })
        return json({ removed: true, id: parsed.data.id })
      } catch {
        return json({ error: "Die Staging-Kopie konnte nicht entfernt werden." })
      }
    }

    return json({ error: "Dieses Werkzeug ist nicht verfügbar." })
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}
