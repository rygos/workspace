// Plugin-SDK mit erweiterten APIs

import { PluginLifecycle } from './pluginLifecycle';
import { CapabilityRegistry } from './capabilityRegistry';
import { EventBus } from './eventBus';
import { LocalDatabase } from '../persistence/database';

export class PluginSDK {
  private capabilities: { [key: string]: any } = {};
  private eventBus: EventBus;
  private capabilityRegistry: CapabilityRegistry;
  private db: LocalDatabase;

  constructor(eventBus: EventBus, capabilityRegistry: CapabilityRegistry, db: LocalDatabase) {
    this.eventBus = eventBus;
    this.capabilityRegistry = capabilityRegistry;
    this.db = db;
  }

  registerPlugin(plugin: { id: string; name: string; version: string; entrypoint: string }): void {
    console.log(`Registering plugin: ${plugin.name} v${plugin.version}`);
    
    // Plugin-Registrierung in der Datenbank
    this.db.savePlugin(plugin);
    
    // Plugin Lifecycle aktualisieren
    PluginLifecycle.setState(LifecycleState.Loaded);
  }

  registerCapability(name: string, capability: any): void {
    this.capabilities[name] = capability;
    console.log(`Registered capability: ${name}`);
    this.capabilityRegistry.register(name, capability);
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
        await this.db.saveSetting(`${namespace}-${key}`, JSON.stringify(value));
      },
      async load(key: string): Promise<any | null> {
        const value = await this.db.getSetting(`${namespace}-${key}`);
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
    
    // Plugin Lifecycle aktualisieren
    if (status === 'degraded') {
      PluginLifecycle.setState(LifecycleState.Degraded);
    } else if (status === 'failed') {
      PluginLifecycle.setState(LifecycleState.Failed);
    }
  }

  validatePlugin(plugin: { id: string; name: string; version: string; entrypoint: string }): boolean {
    // Einfache Validierung
    if (!plugin.id || !plugin.name || !plugin.version) {
      console.error(`Plugin ${plugin.name} is invalid`);
      return false;
    }
    
    console.log(`Plugin ${plugin.name} validated successfully`);
    return true;
  }

  async getPlugins(): Promise<Array<{ id: string; name: string; version: string }>> {
    const plugins = await this.db.listPlugins();
    return plugins;
  }
}

const pluginSdk = new PluginSDK(EventBus, CapabilityRegistry, db);
