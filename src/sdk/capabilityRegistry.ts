// Capability Registry für Plugin-Interoperabilität

class CapabilityRegistry {
  private capabilities: { [key: string]: any } = {};

  register(name: string, capability: any): void {
    this.capabilities[name] = capability;
    console.log(`Registered capability: ${name}`);
  }

  get(name: string): any {
    return this.capabilities[name];
  }
}

export default new CapabilityRegistry();
