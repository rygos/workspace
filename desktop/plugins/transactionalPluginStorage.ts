import { type ZodType, z } from "zod"
import type { PluginStorageApi } from "../core/persistence"

export class TransactionalPluginStorage implements PluginStorageApi {
  private readonly changes = new Map<
    string,
    { readonly kind: "set"; readonly value: unknown } | { readonly kind: "remove" }
  >()
  private finished = false
  private committed = false
  private accepted = false
  private readonly previous = new Map<string, unknown>()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly base: PluginStorageApi) {}

  async get<T>(key: string, schema: ZodType<T>): Promise<T | undefined> {
    this.assertOpen()
    if (this.committed) return this.base.get(key, schema)
    const change = this.changes.get(key)
    if (change?.kind === "remove") return undefined
    if (change?.kind === "set") return schema.parse(change.value)
    return this.base.get(key, schema)
  }

  async set<T>(key: string, value: T, schema: ZodType<T>): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      if (this.accepted) return this.base.set(key, value, schema)
      if (this.committed) {
        await this.capturePrevious(key)
        return this.base.set(key, value, schema)
      }
      const parsedValue = schema.parse(value)
      this.assertCapacity(this.changes, key, JSON.stringify(parsedValue))
      this.changes.set(key, { kind: "set", value: parsedValue })
    })
  }

  async remove(key: string): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      if (this.accepted) return this.base.remove(key)
      if (this.committed) {
        await this.capturePrevious(key)
        return this.base.remove(key)
      }
      this.assertCapacity(this.changes, key, "null")
      this.changes.set(key, { kind: "remove" })
    })
  }

  async commit(): Promise<void> {
    return this.enqueue(async () => {
      this.assertOpen()
      if (this.committed) return
      for (const key of this.changes.keys()) await this.capturePrevious(key)
      try {
        for (const [key, change] of this.changes) {
          if (change.kind === "remove") await this.base.remove(key)
          else await this.base.set(key, change.value, z.unknown())
        }
        this.committed = true
        this.changes.clear()
      } catch (error) {
        let rollbackError: unknown
        for (const [key, value] of [...this.previous].reverse()) {
          try {
            if (value === undefined) await this.base.remove(key)
            else await this.base.set(key, value, z.unknown())
          } catch (restoreError) {
            rollbackError = restoreError
          }
        }
        this.finished = true
        this.changes.clear()
        this.previous.clear()
        if (rollbackError !== undefined) {
          throw new Error(
            "Plugin-Speicher konnte nach fehlgeschlagener Aktivierung nicht vollständig zurückgesetzt werden.",
          )
        }
        throw error
      }
    })
  }

  async rollback(): Promise<void> {
    return this.enqueue(async () => {
      if (this.finished) return
      if (this.committed && !this.accepted) {
        for (const [key, value] of [...this.previous].reverse()) {
          if (value === undefined) await this.base.remove(key)
          else await this.base.set(key, value, z.unknown())
        }
      }
      this.finished = true
      this.committed = false
      this.previous.clear()
      this.changes.clear()
    })
  }

  finalize(): void {
    if (!this.committed || this.finished)
      throw new Error("Die Plugin-Speichertransaktion ist nicht bereit.")
  }

  accept(): void {
    if (!this.committed || this.finished)
      throw new Error("Die Plugin-Speichertransaktion ist nicht bereit.")
    this.accepted = true
    this.previous.clear()
  }

  private async capturePrevious(key: string): Promise<void> {
    if (this.previous.has(key)) return
    if (this.previous.size >= 128) {
      throw new Error(
        "Das Plugin hat das Speicherlimit für eine sichere Wiederherstellung erreicht.",
      )
    }
    const value = await this.base.get(key, z.unknown())
    const serialized = JSON.stringify(value) ?? "null"
    const currentBytes = [...this.previous].reduce(
      (total, [previousKey, previous]) =>
        total +
        new TextEncoder().encode(previousKey + (JSON.stringify(previous) ?? "null")).byteLength,
      0,
    )
    if (currentBytes + new TextEncoder().encode(key + serialized).byteLength > 1024 * 1024) {
      throw new Error("Der Plugin-Speicher überschreitet das Wiederherstellungslimit.")
    }
    this.previous.set(key, value)
  }

  private assertCapacity(
    changes: Map<
      string,
      { readonly kind: "set"; readonly value: unknown } | { readonly kind: "remove" }
    >,
    key: string,
    serializedValue: string,
  ): void {
    if (!changes.has(key) && changes.size >= 128) {
      throw new Error(
        "Das Plugin hat das Speicherlimit für eine sichere Wiederherstellung erreicht.",
      )
    }
    const currentBytes = [...changes].reduce((total, [changeKey, change]) => {
      const value = change.kind === "set" ? (JSON.stringify(change.value) ?? "null") : "null"
      return total + new TextEncoder().encode(changeKey + value).byteLength
    }, 0)
    const previous = changes.get(key)
    const replacedBytes =
      previous === undefined
        ? 0
        : new TextEncoder().encode(
            key + (previous.kind === "set" ? (JSON.stringify(previous.value) ?? "null") : "null"),
          ).byteLength
    if (
      currentBytes - replacedBytes + new TextEncoder().encode(key + serializedValue).byteLength >
      1024 * 1024
    ) {
      throw new Error("Der Plugin-Speicher überschreitet das Wiederherstellungslimit.")
    }
  }

  private assertOpen(): void {
    if (this.finished) throw new Error("Die transaktionale Plugin-Aktivierung ist bereits beendet.")
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
