import { describe, expect, test } from "bun:test"
import { z } from "zod"
import type { IncidentJournalStorage } from "../core/incidentManager"
import { IncidentJournal } from "../core/incidentManager"
import { Logger } from "../core/logger"
import { WorkshopPluginHost } from "../plugins/host"
import { ReadOnlyAgentTools } from "./tools"

function createIncidentJournal(): IncidentJournal {
  let persisted: unknown
  const storage: IncidentJournalStorage = {
    read: async () => persisted,
    write: async (state) => {
      persisted = state
    },
  }
  return new IncidentJournal(storage)
}

describe("read-only development tools", () => {
  test("exposes safe plugin state and does not accept extra arguments", async () => {
    const incidents = createIncidentJournal()
    const host = new WorkshopPluginHost({
      incidents,
      logger: new Logger(() => undefined),
      storageFor: () => ({
        get: async () => undefined,
        set: async () => undefined,
        remove: async () => undefined,
      }),
    })
    await host.discover()
    const tools = new ReadOnlyAgentTools(host, incidents, new Logger(() => undefined))

    const plugins = z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          quarantined: z.boolean(),
        }),
      )
      .parse(JSON.parse(await tools.execute("list_plugins", "{}")))
    const toolErrorSchema = z.object({ error: z.string() })
    const invalid = toolErrorSchema.parse(
      JSON.parse(await tools.execute("list_plugins", '{"path":"/"}')),
    )
    const unavailable = toolErrorSchema.parse(
      JSON.parse(await tools.execute("read_file", '{"path":"/etc/passwd"}')),
    )

    expect(plugins).toEqual([
      expect.objectContaining({ id: "demo-notes", status: "discovered", quarantined: false }),
    ])
    expect(invalid).toEqual({ error: "Dieses Werkzeug erwartet keine Argumente." })
    expect(unavailable).toEqual({ error: "Dieses Werkzeug ist nicht verfügbar." })
  })

  test("bounds log reads and removes common bearer and API-key patterns", async () => {
    const incidents = createIncidentJournal()
    const host = new WorkshopPluginHost({
      incidents,
      logger: new Logger(() => undefined),
      storageFor: () => ({
        get: async () => undefined,
        set: async () => undefined,
        remove: async () => undefined,
      }),
    })
    const logger = new Logger(() => undefined)
    logger.info("provider", "Bearer secret-value sk-1234567890")
    const tools = new ReadOnlyAgentTools(host, incidents, logger)

    const logs = z
      .array(z.object({ message: z.string() }))
      .parse(JSON.parse(await tools.execute("read_logs", '{"limit":1}')))
    const invalid = z
      .object({ error: z.string() })
      .parse(JSON.parse(await tools.execute("read_logs", '{"limit":1000}')))

    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toBe("Bearer [ENTFERNT] [SCHLÜSSEL ENTFERNT]")
    expect(invalid).toEqual({ error: "Die Protokollgrenze muss zwischen 1 und 25 liegen." })
  })
})
