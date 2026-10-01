// UI-Plugin-Manager für die Verwaltung von Plugins

import { PluginLoader } from '../sdk/pluginLoader';
import { PluginLifecycle } from '../sdk/pluginLifecycle';

export class PluginManager {
  private pluginLoader: PluginLoader;

  constructor() {
    this.pluginLoader = new PluginLoader();
  }

  async renderPluginList(): Promise<void> {
    try {
      const plugins = await this.pluginLoader.listPlugins();
      
      console.log('Rendering plugin list:');
      plugins.forEach(plugin => {
        console.log(`- ${plugin.name} v${plugin.version} (ID: ${plugin.id})`);
        
        // Plugin-Zustand anzeigen
        const state = PluginLifecycle.getState();
        console.log(`  Status: ${state}`);
      });
    } catch (error) {
      console.error('Failed to render plugin list:', error);
    }
  }

  async loadPlugin(pluginId: string): Promise<void> {
    try {
      await this.pluginLoader.loadPlugin(pluginId);
      console.log(`Plugin ${pluginId} successfully loaded`);
      
      // Plugin-Zustand aktualisieren
      const state = PluginLifecycle.getState();
      console.log(`New status: ${state}`);
    } catch (error) {
      console.error(`Failed to load plugin ${pluginId}:`, error);
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    try {
      await this.pluginLoader.unloadPlugin(pluginId);
      console.log(`Plugin ${pluginId} successfully unloaded`);
      
      // Plugin-Zustand aktualisieren
      const state = PluginLifecycle.getState();
      console.log(`New status: ${state}`);
    } catch (error) {
      console.error(`Failed to unload plugin ${pluginId}:`, error);
    }
  }
}

const pluginManager = new PluginManager();
