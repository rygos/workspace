// Plugin-SDK mit erweiterten APIs

export class PluginSDK {
  private capabilities: { [key: string]: any } = {};
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  registerPlugin(plugin: { id: string; name: string; version: string; entrypoint: string }): void {
    console.log(`Registering plugin: ${plugin.name} v${plugin.version}`);
    // Plugin-Registrierung in der Datenbank
    db.savePlugin(plugin);
  }

  registerCapability(name: string, capability: any): void {
    this.capabilities[name] = capability;
    console.log(`Registered capability: ${name}`);
  }

  getCapability(name: string): any {
    return this.capabilities[name];
  }

  subscribeEvent(eventType: string, callback: Function): void {
    this.eventBus.subscribe(eventType, callback);
  }

  emitEvent(eventType: string, data: any): void {
    this.eventBus.emit(eventType, data);
  }

  getStorage(namespace: string): { 
    save(key: string, value: any): Promise<void>;
    load(key: string): Promise<any | null>;
  } {
    return {
      async save(key: string, value: any): Promise<void> {
        await db.saveSetting(`${namespace}-${key}`, JSON.stringify(value));
      },
      async load(key: string): Promise<any | null> {
        const value = await db.getSetting(`${namespace}-${key}`);
        return value ? JSON.parse(value) : null;
      }
    };
  }

  getLogger(): { 
    log(message: string): void;
    error(message: string): void;
  } {
    return {
      log(message: string): void {
        logger.log(`[PLUGIN] ${message}`);
      },
      error(message: string): void {
        logger.error(`[PLUGIN] ${message}`);
      }
    };
  }

  reportHealth(status: 'healthy' | 'degraded' | 'failed'): void {
    console.log(`Plugin health reported as: ${status}`);
    // Hier könnte der Plugin-Lifecycle aktualisiert werden
  }
}

const pluginSdk = new PluginSDK(EventBus);
