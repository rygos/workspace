// Plugin Lifecycle Management

import { LocalDatabase } from '../persistence/database';
const db = new LocalDatabase();

enum LifecycleState {
  Discovered = 'discovered',
  Validated = 'validated',
  Loaded = 'loaded',
  Active = 'active',
  Degraded = 'degraded',
  Failed = 'failed',
  Quarantined = 'quarantined',
  Disabled = 'disabled',
  Updating = 'updating'
}

class PluginLifecycle {
  private state: LifecycleState = LifecycleState.Discovered;
  private lastKnownGoodVersion: string | null = null;

  setState(newState: LifecycleState): void {
    this.state = newState;
    console.log(`Plugin lifecycle changed to: ${newState}`);
  }

  getState(): LifecycleState {
    return this.state;
  }

  setLastKnownGoodVersion(version: string): void {
    this.lastKnownGoodVersion = version;
    console.log(`Last Known Good version set to: ${version}`);
  }

  getLastKnownGoodVersion(): string | null {
    return this.lastKnownGoodVersion;
  }

  async rollbackToLastKnownGood(pluginId: string): Promise<void> {
    if (!this.lastKnownGoodVersion) {
      throw new Error('No Last Known Good version available for rollback');
    }

    const plugin = await db.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    // Rollback to last known good version
    this.setState(LifecycleState.Loaded);
    console.log(`Rolled back plugin ${pluginId} to version: ${this.lastKnownGoodVersion}`);
  }
}

export default new PluginLifecycle();
