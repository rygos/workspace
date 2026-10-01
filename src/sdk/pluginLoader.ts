// Plugin Loader für dynamisches Laden von Plugins

import { PluginSDK } from './pluginSdk';
import { PluginLifecycle } from './pluginLifecycle';
import { CapabilityRegistry } from './capabilityRegistry';
import { EventBus } from './eventBus';
import { LocalDatabase } from '../persistence/database';

export class PluginLoader {
  private pluginSdk: PluginSDK;
  private db: LocalDatabase;

  constructor() {
    this.pluginSdk = new PluginSDK(EventBus, CapabilityRegistry);
    this.db = new LocalDatabase();
  }

  async loadPlugin(pluginId: string): Promise<void> {
    try {
      const plugin = await this.db.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found in database`);
      }

      // Plugin Lifecycle aktualisieren
      PluginLifecycle.setState(LifecycleState.Loading);

      // Plugin registrieren
      this.pluginSdk.registerPlugin(plugin);

      // Plugin Lifecycle aktualisieren
      PluginLifecycle.setState(LifecycleState.Loaded);
      
      console.log(`Plugin ${plugin.name} v${plugin.version} successfully loaded`);
    } catch (error) {
      console.error(`Failed to load plugin ${pluginId}:`, error);
      PluginLifecycle.setState(LifecycleState.Failed);
      throw error;
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    try {
      const plugin = await this.db.getPlugin(pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${pluginId} not found in database`);
      }

      // Plugin Lifecycle aktualisieren
      PluginLifecycle.setState(LifecycleState.Unloading);

      // Plugin deaktivieren (simuliert)
      console.log(`Unloading plugin ${plugin.name} v${plugin.version}`);
      
      // Plugin Lifecycle aktualisieren
      PluginLifecycle.setState(LifecycleState.Disabled);
    } catch (error) {
      console.error(`Failed to unload plugin ${pluginId}:`, error);
      throw error;
    }
  }

  async listPlugins(): Promise<Array<{ id: string; name: string; version: string }>> {
    const plugins = await this.db.getPlugins();
    return plugins.map(plugin => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version
    }));
  }
}

const pluginLoader = new PluginLoader();
