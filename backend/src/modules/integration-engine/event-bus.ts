// ============================================================
// event-bus.ts — In-memory pub/sub
// Designed for drop-in replacement with Redis/Kafka later.
// ============================================================
import type { IntegrationEvent, IntegrationEventType, EventHandler } from './integration.types';

export class EventBus {
  private readonly handlers = new Map<IntegrationEventType, Set<EventHandler>>();

  subscribe<T>(type: IntegrationEventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as EventHandler);
    // Return unsubscribe function
    return () => this.unsubscribe(type, handler as EventHandler);
  }

  unsubscribe(type: IntegrationEventType, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  async publish<T>(event: IntegrationEvent<T>): Promise<void> {
    const subs = this.handlers.get(event.type);
    if (!subs?.size) return;
    const results = await Promise.allSettled([...subs].map(h => h(event as IntegrationEvent)));
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(`[EventBus] Handler for ${event.type} failed:`, r.reason);
      }
    }
  }

  /** Synchronous emit — used in tests and tight loops where async is not needed */
  emit<T>(type: IntegrationEventType, userId: string, payload: T): void {
    const event: IntegrationEvent<T> = {
      type, user_id: userId, payload,
      emitted_at: new Date().toISOString(),
    };
    // Fire-and-forget; errors are swallowed per handler
    this.handlers.get(type)?.forEach(h => {
      try { h(event as IntegrationEvent); } catch { /* isolated */ }
    });
  }

  /** Number of active subscribers per type — used in tests/metrics */
  subscriberCount(type: IntegrationEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
