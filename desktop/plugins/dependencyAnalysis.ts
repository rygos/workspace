import type { PluginManifest } from "./contracts"

export type DeclaredDependencyIssue = {
  readonly pluginId: string
  readonly dependencyId: string
  readonly expectedVersion: string
  readonly actualVersion?: string
  readonly kind: "missing" | "version-mismatch"
}

export type DeclaredCapabilityEdge = {
  readonly capability: string
  readonly provider: string
  readonly consumer: string
}

export type DependencyAnalysis = {
  readonly declaredDependencies: readonly {
    readonly pluginId: string
    readonly dependencyId: string
    readonly version: string
  }[]
  readonly declaredCapabilities: readonly DeclaredCapabilityEdge[]
  readonly issues: readonly DeclaredDependencyIssue[]
  readonly cycles: readonly (readonly string[])[]
}

export function analyzePluginDependencies(
  manifests: readonly PluginManifest[],
): DependencyAnalysis {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const declaredDependencies: DependencyAnalysis["declaredDependencies"] = manifests.flatMap(
    (manifest) =>
      manifest.dependencies.map((dependency) => ({
        pluginId: manifest.id,
        dependencyId: dependency.id,
        version: dependency.version,
      })),
  )
  const issues: DeclaredDependencyIssue[] = []
  for (const { pluginId, dependencyId, version } of declaredDependencies) {
    const target = byId.get(dependencyId)
    if (target === undefined) {
      issues.push({ pluginId, dependencyId, expectedVersion: version, kind: "missing" })
    } else if (target.version !== version) {
      issues.push({
        pluginId,
        dependencyId,
        expectedVersion: version,
        actualVersion: target.version,
        kind: "version-mismatch",
      })
    }
  }

  const declaredCapabilities: DeclaredCapabilityEdge[] = []
  for (const consumer of manifests) {
    for (const capability of consumer.consumes) {
      for (const provider of manifests) {
        if (provider.provides.includes(capability)) {
          declaredCapabilities.push({ capability, provider: provider.id, consumer: consumer.id })
        }
      }
    }
  }

  return {
    declaredDependencies,
    declaredCapabilities,
    issues,
    cycles: findDependencyCycles(manifests),
  }
}

function findDependencyCycles(
  manifests: readonly PluginManifest[],
): readonly (readonly string[])[] {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const complete = new Set<string>()
  const stack: string[] = []
  const cycles = new Map<string, readonly string[]>()

  const visit = (pluginId: string): void => {
    const cycleStart = stack.indexOf(pluginId)
    if (cycleStart >= 0) {
      const cycle = [...stack.slice(cycleStart), pluginId]
      const key = [...new Set(cycle.slice(0, -1))].sort().join("|")
      cycles.set(key, cycle)
      return
    }
    if (complete.has(pluginId)) return
    const manifest = byId.get(pluginId)
    if (manifest === undefined) return
    stack.push(pluginId)
    for (const dependency of manifest.dependencies) visit(dependency.id)
    stack.pop()
    complete.add(pluginId)
  }

  for (const manifest of manifests) visit(manifest.id)
  return [...cycles.values()]
}
