// The live messages: the indexer publishes the messages of each applied block (and a reorg
// message after an undo); each open stream gets them.
import type { StreamMessage } from '@gaia/core';

export type LiveMessageListener = (message: StreamMessage) => void;

export class LiveMessageBus {
  // The listeners by subscription ID, in the order they subscribed.
  private readonly listeners = new Map<number, LiveMessageListener>();
  private nextSubscriptionId = 1;

  /** Adds a listener. Returns the function that removes it. */
  subscribe(listener: LiveMessageListener): () => void {
    const subscriptionId = this.nextSubscriptionId++;
    this.listeners.set(subscriptionId, listener);
    return () => {
      this.listeners.delete(subscriptionId);
    };
  }

  publish(messages: readonly StreamMessage[]) {
    for (const message of messages) {
      for (const listener of this.listeners.values()) {
        listener(message);
      }
    }
  }

  get size() {
    return this.listeners.size;
  }
}
