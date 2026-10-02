import { z } from "zod"
import type { PluginStorageApi } from "../core/persistence"
import { type PluginManifest, PluginManifestSchema } from "./contracts"
import { SANDBOX_BOOTSTRAP } from "./sandboxBootstrap"

const MAX_MESSAGE_BYTES = 64 * 1024
const START_TIMEOUT_MS = 8_000
const STORAGE_KEY = /^[a-z][a-z0-9-]{0,62}$/
const SANDBOX_BOOTSTRAP_HASH = "sha256-1lMgAEGlMecH2FqS/rdFgmIx2cK5Zr+vDZrdy4alWd4="

const RequestSchema = z
  .object({
    kind: z.literal("request"),
    id: z.string().uuid(),
    method: z.enum(["storage.get", "storage.set", "storage.remove"]),
    key: z.string().regex(STORAGE_KEY),
    value: z.unknown().optional(),
  })
  .strict()

const FrameMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), pluginId: z.string() }).strict(),
  z.object({ kind: z.literal("failed"), message: z.string().max(240) }).strict(),
  z.object({ kind: z.literal("runtime-failed") }).strict(),
  RequestSchema,
])
const BootstrapReadySchema = z.object({ kind: z.literal("bootstrap-ready") }).strict()

export class SandboxedPluginFrame {
  private frame: HTMLIFrameElement | undefined
  private onMessage: ((event: MessageEvent<unknown>) => void) | undefined
  private cancelStart: (() => void) | undefined
  private readonly pending = new Map<string, (response: unknown) => void>()

  constructor(
    private readonly manifest: PluginManifest,
    private readonly storage: PluginStorageApi,
    private readonly onRuntimeFailure: () => void = () => undefined,
  ) {}

  async mount(container: HTMLElement, entrypointSource: string): Promise<void> {
    if (this.frame !== undefined) throw new Error("Dieses Plugin ist bereits isoliert geladen.")
    const manifest = PluginManifestSchema.safeParse(this.manifest)
    if (!manifest.success) throw new Error("Das Plugin-Manifest ist ungültig.")
    const entrypointBytes = new TextEncoder().encode(entrypointSource).byteLength
    if (entrypointBytes === 0 || entrypointBytes > 256 * 1024) {
      throw new Error("Der Plugin-Einstieg muss zwischen 1 Byte und 256 KiB groß sein.")
    }
    if (this.manifest.permissions.some((permission) => permission !== "storage")) {
      throw new Error("Die isolierte Plugin-Vorschau unterstützt derzeit nur lokalen Speicher.")
    }

    const frame = document.createElement("iframe")
    frame.title = `${this.manifest.name} isolierte Erweiterung`
    frame.referrerPolicy = "no-referrer"
    frame.setAttribute("sandbox", "allow-scripts")
    frame.srcdoc = sandboxDocument()
    this.frame = frame
    let sourceDelivered = false
    this.onMessage = (event) => {
      if (event.source !== frame.contentWindow) return
      if (BootstrapReadySchema.safeParse(event.data).success && !sourceDelivered) {
        sourceDelivered = true
        frame.contentWindow?.postMessage(
          {
            kind: "load",
            manifest: manifest.data,
            entrypoint: entrypointSource,
          },
          "*",
        )
        return
      }
      void this.handleMessage(event.data)
    }
    window.addEventListener("message", this.onMessage)
    container.append(frame)

    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        window.removeEventListener("message", onReady)
        this.cancelStart = undefined
        if (error === undefined) resolve()
        else reject(error)
      }
      const onReady = (event: MessageEvent<unknown>): void => {
        if (event.source !== frame.contentWindow) return
        const parsed = FrameMessageSchema.safeParse(event.data)
        if (!parsed.success || (parsed.data.kind !== "ready" && parsed.data.kind !== "failed"))
          return
        if (parsed.data.kind === "ready" && parsed.data.pluginId === this.manifest.id) finish()
        else if (parsed.data.kind === "failed") finish(new Error(parsed.data.message))
        else finish(new Error("Die Plugin-ID stimmt nicht überein."))
      }
      const timeout = window.setTimeout(
        () => finish(new Error("Das isolierte Plugin reagiert nicht.")),
        START_TIMEOUT_MS,
      )
      let settled = false
      this.cancelStart = () => finish(new Error("Die Plugin-Vorschau wurde geschlossen."))
      window.addEventListener("message", onReady)
    }).catch((error: unknown) => {
      this.unmount()
      throw error
    })
  }

  unmount(): void {
    const frame = this.frame
    if (frame === undefined) return
    this.cancelStart?.()
    this.cancelStart = undefined
    if (this.onMessage !== undefined) window.removeEventListener("message", this.onMessage)
    frame.remove()
    this.frame = undefined
    this.onMessage = undefined
    for (const resolve of this.pending.values())
      resolve({ ok: false, error: "Plugin geschlossen." })
    this.pending.clear()
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const parsed = FrameMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.kind === "runtime-failed") {
      this.onRuntimeFailure()
      return
    }
    if (message.kind !== "request") return
    const frame = this.frame
    if (frame?.contentWindow === null || frame === undefined) return
    if (
      this.pending.has(message.id) ||
      this.pending.size >= 32 ||
      !this.manifest.permissions.includes("storage")
    ) {
      this.respond(frame, message.id, { ok: false, error: "Anfrage nicht erlaubt." })
      return
    }

    const serialized = serializeWithinLimit(message.value)
    if (message.method === "storage.set" && serialized === undefined) {
      this.respond(frame, message.id, {
        ok: false,
        error: "Der Speicherwert ist ungültig oder zu groß.",
      })
      return
    }
    const response = await this.pendingRequest(message.id, async () => {
      switch (message.method) {
        case "storage.get":
          return { ok: true, value: await this.storage.get(message.key, z.unknown()) }
        case "storage.set": {
          const value: unknown = JSON.parse(serialized ?? "null")
          await this.storage.set(message.key, value, z.unknown())
          return { ok: true }
        }
        case "storage.remove":
          await this.storage.remove(message.key)
          return { ok: true }
        default:
          return assertNever(message.method)
      }
    })
    this.respond(frame, message.id, response)
  }

  private async pendingRequest(id: string, action: () => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      void action()
        .then(
          (response) => resolve(response),
          () => resolve({ ok: false, error: "Plugin-Speicherzugriff fehlgeschlagen." }),
        )
        .finally(() => {
          if (this.pending.get(id) === resolve) this.pending.delete(id)
        })
    })
  }

  private respond(frame: HTMLIFrameElement, id: string, response: unknown): void {
    const serialized = serializeWithinLimit(response)
    if (serialized === undefined) {
      frame.contentWindow?.postMessage(
        {
          kind: "response",
          id,
          response: { ok: false, error: "Antwort überschreitet das Sandbox-Limit." },
        },
        "*",
      )
      return
    }
    const boundedResponse: unknown = JSON.parse(serialized)
    frame.contentWindow?.postMessage({ kind: "response", id, response: boundedResponse }, "*")
  }
}

function sandboxDocument(): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${SANDBOX_BOOTSTRAP_HASH}' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body><main id="plugin-root"></main><script>${SANDBOX_BOOTSTRAP}</script></body></html>`
}

function serializeWithinLimit(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value)
    return serialized !== undefined &&
      new TextEncoder().encode(serialized).length <= MAX_MESSAGE_BYTES
      ? serialized
      : undefined
  } catch {
    return undefined
  }
}

function assertNever(value: never): never {
  throw new Error(`Unbekannte Sandbox-Anfrage: ${String(value)}`)
}
