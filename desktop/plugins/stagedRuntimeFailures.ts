import type { LoadedPlugin } from "./stagedRuntimeTypes"

export type StagedPluginRuntimeFailure = {
  readonly pluginId: string
  readonly version: string
  readonly stageId: string
  readonly entrypoint: string
}

export class StagedPluginFailureChannel {
  private readonly listeners = new Set<(failure: StagedPluginRuntimeFailure) => void>()

  subscribe(listener: (failure: StagedPluginRuntimeFailure) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(plugin: LoadedPlugin): void {
    const failure = {
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      stageId: plugin.stageId,
      entrypoint: plugin.entrypoint,
    }
    for (const listener of this.listeners) listener(failure)
  }
}
