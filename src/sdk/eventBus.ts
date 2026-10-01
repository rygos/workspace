// Event-Bus für Plugins und Komponenten

class EventBus {
  private listeners: { [key: string]: Function[] } = {};

  subscribe(eventType: string, callback: Function): void {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
  }

  emit(eventType: string, data: any): void {
    const callbacks = this.listeners[eventType];
    if (callbacks) {
      callbacks.forEach((callback) => callback(data));
    }
  }
}

export default new EventBus();
