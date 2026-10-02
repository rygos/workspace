import { logger } from "../core/logger"

export class EventBus<Event extends WorkshopEvent> {
  private listeners = new Set<(event: Event) => void>()

  constructor(
    private readonly onListenerFailure: (event: Event, error: unknown) => void = (event, error) => {
      logger.error(
        "event-bus",
        `Handler für ${event.type} ist fehlgeschlagen: ${errorMessage(error)}`,
      )
    },
  ) {}

  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: Event): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        this.onListenerFailure(event, error)
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.name : "Unbekannter Fehler"
}

import type { WorkshopEvent } from "./contracts"
