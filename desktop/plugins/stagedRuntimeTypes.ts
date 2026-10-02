import type { PluginManifest } from "./contracts"
import type { SandboxedPluginFrame } from "./sandbox"
import type { TransactionalPluginStorage } from "./transactionalPluginStorage"

export type LoadedPlugin = {
  readonly stageId: string
  readonly manifest: PluginManifest
  readonly entrypoint: string
  readonly sandbox: SandboxedPluginFrame
  readonly frame: HTMLIFrameElement
  readonly temporaryMount: HTMLElement
  readonly storage: TransactionalPluginStorage
  readonly fallback: PluginSnapshot | undefined
  readonly hasFailed: () => boolean
}

export type PluginSnapshot = {
  readonly stageId: string
  readonly manifest: PluginManifest
  readonly entrypoint: string
  readonly fallback: PluginSnapshot | undefined
}

export type StagedRuntimeState = {
  readonly status:
    | "inactive"
    | "starting"
    | "active"
    | "reloading"
    | "observing"
    | "failed"
    | "recovering"
  readonly pluginId?: string
  readonly name?: string
  readonly version?: string
  readonly stageId?: string
}

export const HOT_RELOAD_OBSERVATION_MS = 10_000

export function snapshot(plugin: LoadedPlugin): PluginSnapshot {
  return {
    stageId: plugin.stageId,
    manifest: plugin.manifest,
    entrypoint: plugin.entrypoint,
    fallback: plugin.fallback,
  }
}

export function scheduleAfter(elapsed: () => void, delayMs: number): () => void {
  const timer = globalThis.setTimeout(elapsed, delayMs)
  return () => globalThis.clearTimeout(timer)
}

export function stateFor(
  status: StagedRuntimeState["status"],
  plugin: Pick<LoadedPlugin, "stageId" | "manifest">,
): StagedRuntimeState {
  return {
    status,
    pluginId: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    stageId: plugin.stageId,
  }
}
