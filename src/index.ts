// Einstiegspunkt der Anwendung

import { EventBus } from './sdk/eventBus';
import { PluginLifecycle } from './sdk/pluginLifecycle';

console.log('Codex Specification Package - Self-Evolving AI Desktop Platform');

// Initialisiere Event-Bus und Lifecycle-Manager
EventBus.emit('app-started', { status: 'running' });
PluginLifecycle.setState(LifecycleState.Active);

console.log('Application started.');
