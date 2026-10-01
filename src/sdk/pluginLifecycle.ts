// Plugin Lifecycle Management

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

  setState(newState: LifecycleState): void {
    this.state = newState;
    console.log(`Plugin lifecycle changed to: ${newState}`);
  }

  getState(): LifecycleState {
    return this.state;
  }
}

export default new PluginLifecycle();
