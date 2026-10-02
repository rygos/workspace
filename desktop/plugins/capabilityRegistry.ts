import type { CapabilityEdge } from "./contracts"

type Registration<C> = {
  [K in keyof C]?: { readonly provider: string; readonly value: C[K] }
}

export class CapabilityRegistry<Contracts extends object> {
  private readonly registrations: Registration<Contracts> = {}
  private readonly edges = new Map<string, CapabilityEdge>()

  register<K extends keyof Contracts>(
    key: K,
    provider: string,
    capability: Contracts[K],
  ): () => void {
    if (this.registrations[key] !== undefined) {
      throw new Error(`Capability ist bereits registriert: ${String(key)}`)
    }
    this.registrations[key] = { provider, value: capability }
    return () => {
      if (this.registrations[key]?.provider === provider) delete this.registrations[key]
      for (const [edgeKey, edge] of this.edges) {
        if (edge.capability === String(key) && edge.provider === provider)
          this.edges.delete(edgeKey)
      }
    }
  }

  resolve<K extends keyof Contracts>(key: K, consumer: string): Contracts[K] | undefined {
    const registration = this.registrations[key]
    if (registration === undefined) return undefined
    const capabilityName = String(key)
    const edgeKey = `${registration.provider}:${consumer}:${capabilityName}`
    this.edges.set(edgeKey, {
      capability: capabilityName,
      provider: registration.provider,
      consumer,
    })
    return registration.value
  }

  dependencyGraph(): readonly CapabilityEdge[] {
    return [...this.edges.values()]
  }
}
