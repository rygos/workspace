import { z } from "zod"
import type { PluginDefinition } from "./runtime"

const NoteSchema = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(2000) })
const NotesSchema = z.array(NoteSchema).max(500)

export type Note = z.infer<typeof NoteSchema>

export type NotesService = {
  list: () => Promise<readonly Note[]>
  create: (text: string) => Promise<Note>
  update: (id: string, text: string) => Promise<Note>
  remove: (id: string) => Promise<void>
}

export type DemoCapabilities = { "notes.v1": NotesService }
export type DemoEvent =
  | { readonly type: "notes.changed"; readonly payload: { readonly notes: readonly Note[] } }
  | { readonly type: "plugin.failed"; readonly payload: { readonly pluginId: string } }

export const demoNotesPlugin: PluginDefinition<DemoCapabilities, DemoEvent> = {
  manifest: {
    id: "demo-notes",
    name: "Demo Notes",
    description: "Notizen mit lokalem, validiertem Speicher erstellen und verwalten.",
    version: "0.1.0",
    apiVersion: 1,
    entrypoint: "index.js",
    permissions: ["storage", "events", "capabilities"],
    provides: ["notes.v1"],
    consumes: [],
    events: ["notes.changed"],
    uiContributions: ["workspace"],
  },
  async activate({ storage, events, capabilities }) {
    let notes = (await storage.get("notes", NotesSchema)) ?? []
    const notify = (): void => events.emit({ type: "notes.changed", payload: { notes } })
    const service: NotesService = {
      list: async () => notes,
      create: async (text) => {
        const note = NoteSchema.parse({ id: crypto.randomUUID(), text })
        notes = [...notes, note]
        await storage.set("notes", notes, NotesSchema)
        notify()
        return note
      },
      update: async (id, text) => {
        const existing = notes.find((note) => note.id === id)
        if (existing === undefined) throw new Error("Die Notiz wurde nicht gefunden.")
        const updated = NoteSchema.parse({ ...existing, text })
        notes = notes.map((note) => (note.id === id ? updated : note))
        await storage.set("notes", notes, NotesSchema)
        notify()
        return updated
      },
      remove: async (id) => {
        notes = notes.filter((note) => note.id !== id)
        await storage.set("notes", notes, NotesSchema)
        notify()
      },
    }
    const unregister = capabilities.register("notes.v1", service)
    return unregister
  },
}
