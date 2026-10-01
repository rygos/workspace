// Beispiel-Plugin

import { EventBus } from '../../sdk/eventBus';

export class ExamplePlugin {
  constructor() {
    console.log('Example Plugin initialized.');
  }

  activate(): void {
    console.log('Example Plugin activated.');

    // Beispielevent abonnieren
    EventBus.subscribe('user-logged-in', (data) => {
      console.log(`User logged in: ${data.username}`);
    });

    // Beispiel-Ereignis senden
    setTimeout(() => {
      EventBus.emit('message-sent', { content: 'Hello from Example Plugin!' });
    }, 2000);
  }
}

const plugin = new ExamplePlugin();
plugin.activate();
