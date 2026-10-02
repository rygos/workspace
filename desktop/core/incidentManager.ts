import { isTauri } from "@tauri-apps/api/core"
import { z } from "zod"

const IncidentSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  sourceId: z.string().min(1).max(96),
  fingerprint: z.string().min(1).max(160),
  severity: z.enum(["warning", "error", "critical"]),
  errorName: z.string().min(1).max(96),
  stackFrames: z.string().max(4_096).optional(),
  status: z.enum(["detected", "isolated", "quarantined", "restored", "resolved"]),
  pluginVersion: z.string().max(80).optional(),
  repair: z
    .object({
      status: z.enum([
        "queued",
        "diagnosing",
        "diagnosed",
        "repairing",
        "staged",
        "repair_cancelled",
        "repair_unavailable",
        "repair_failed",
        "unavailable",
        "failed",
      ]),
      summary: z.string().max(2_000).optional(),
    })
    .optional(),
})

const JournalStateSchema = z.object({
  incidents: z.array(IncidentSchema).max(500),
  lastKnownGood: z.record(z.string(), z.string()),
  quarantined: z.array(z.string()).max(256),
  safeMode: z.boolean(),
})

const IncidentListSchema = z.array(IncidentSchema)

export type Incident = z.infer<typeof IncidentSchema>
export type IncidentStatus = Incident["status"]
export type IncidentInput = {
  readonly sourceId: string
  readonly errorName: string
  readonly severity: Incident["severity"]
  readonly stackFrames?: string
  readonly pluginVersion?: string
  readonly status?: IncidentStatus
}

export type IncidentJournalStorage = {
  readonly read: () => Promise<unknown>
  readonly write: (state: unknown) => Promise<void>
}

const JOURNAL_KEY = "incident-journal"
const JOURNAL_FILE = "workshop-incidents.json"
const EMPTY_STATE = {
  incidents: [],
  lastKnownGood: {},
  quarantined: [],
  safeMode: false,
} satisfies z.infer<typeof JournalStateSchema>

export class IncidentJournal {
  private pending: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(incident: Incident) => void>()

  constructor(private readonly storage: IncidentJournalStorage = createRuntimeStorage()) {}

  list(): Promise<readonly Incident[]> {
    return this.serialized(async () => (await this.readState()).incidents)
  }

  subscribe(listener: (incident: Incident) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  create(input: IncidentInput): Promise<Incident> {
    return this.serialized(async () => {
      const state = await this.readState()
      const errorName = safeErrorName(input.errorName)
      const sourceId = safeSourceId(input.sourceId)
      const incident = IncidentSchema.parse({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        sourceId,
        fingerprint: `${sourceId}:${errorName}`,
        severity: input.severity,
        errorName,
        ...(input.stackFrames === undefined
          ? {}
          : { stackFrames: input.stackFrames.slice(0, 4_096) }),
        status: input.status ?? "detected",
        ...(input.pluginVersion === undefined ? {} : { pluginVersion: input.pluginVersion }),
      })
      await this.writeState({ ...state, incidents: [...state.incidents, incident].slice(-500) })
      for (const listener of this.listeners) listener(incident)
      return incident
    })
  }

  updateRepairState(
    id: string,
    status: NonNullable<Incident["repair"]>["status"],
    summary?: string,
  ): Promise<void> {
    return this.serialized(async () => {
      const state = await this.readState()
      if (!state.incidents.some((incident) => incident.id === id)) {
        throw new Error(`Incident wurde nicht gefunden: ${id}`)
      }
      const incidents = state.incidents.map((incident) =>
        incident.id === id
          ? {
              ...incident,
              repair: { status, ...(summary === undefined ? {} : { summary }) },
            }
          : incident,
      )
      await this.writeState({ ...state, incidents })
    })
  }

  transition(id: string, status: IncidentStatus): Promise<void> {
    return this.serialized(async () => {
      const state = await this.readState()
      const incident = state.incidents.find((candidate) => candidate.id === id)
      if (incident === undefined) throw new Error(`Incident wurde nicht gefunden: ${id}`)
      const incidents = state.incidents.map((candidate) =>
        candidate.id === id ? { ...candidate, status } : candidate,
      )
      await this.writeState({ ...state, incidents })
    })
  }

  quarantined(pluginId: string): Promise<boolean> {
    return this.serialized(async () => (await this.readState()).quarantined.includes(pluginId))
  }

  setQuarantined(pluginId: string, quarantined: boolean): Promise<void> {
    return this.serialized(async () => {
      const state = await this.readState()
      const current = new Set(state.quarantined)
      if (quarantined) current.add(pluginId)
      else current.delete(pluginId)
      await this.writeState({ ...state, quarantined: [...current] })
    })
  }

  lastKnownGood(pluginId: string): Promise<string | undefined> {
    return this.serialized(async () => (await this.readState()).lastKnownGood[pluginId])
  }

  recordLastKnownGood(pluginId: string, version: string): Promise<void> {
    return this.serialized(async () => {
      const state = await this.readState()
      await this.writeState({
        ...state,
        lastKnownGood: { ...state.lastKnownGood, [pluginId]: version },
      })
    })
  }

  safeMode(): Promise<boolean> {
    return this.serialized(async () => (await this.readState()).safeMode)
  }

  setSafeMode(safeMode: boolean): Promise<void> {
    return this.serialized(async () => {
      const state = await this.readState()
      await this.writeState({ ...state, safeMode })
    })
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async readState(): Promise<z.infer<typeof JournalStateSchema>> {
    const data = await this.storage.read()
    if (data === undefined) return EMPTY_STATE
    const parsed = JournalStateSchema.safeParse(data)
    if (!parsed.success) throw new Error("Der gespeicherte Incident-Verlauf ist beschädigt.")
    return parsed.data
  }

  private async writeState(state: unknown): Promise<void> {
    const validated = JournalStateSchema.parse(state)
    await this.storage.write(validated)
  }
}

function safeErrorName(value: string): string {
  return /^[A-Za-z][a-zA-Z0-9_.-]{0,95}$/.test(value) ? value : "UnknownError"
}

function safeSourceId(value: string): string {
  if (!/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]{1,62}$/.test(value)) {
    throw new Error("Ungültige Incident-Quelle.")
  }
  return value
}

function createRuntimeStorage(): IncidentJournalStorage {
  if (isTauri()) {
    const storePromise = import("@tauri-apps/plugin-store").then(({ load }) =>
      load(JOURNAL_FILE, { autoSave: false }),
    )
    return {
      read: async () => (await storePromise).get<unknown>(JOURNAL_KEY),
      write: async (state) => {
        const store = await storePromise
        await store.set(JOURNAL_KEY, state)
        await store.save()
      },
    }
  }

  return {
    read: async () => {
      const stored = window.localStorage.getItem(JOURNAL_KEY)
      return stored === null ? undefined : (JSON.parse(stored) as unknown)
    },
    write: async (state) => window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(state)),
  }
}

export const IncidentArraySchema = IncidentListSchema
