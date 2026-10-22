// The live messages: the indexer publishes the messages of each applied block (and a reorg
// message after an undo); each open stream gets them.

import type { StreamMessage } from '@gaia/core';

export type LiveMessageListener = (message: StreamMessage) => void;

export class LiveMessageBus {
  private readonly listeners = new Set<LiveMessageListener>();

  /** Adds a listener. Returns the function that removes it. */
  subscribe(listener: LiveMessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(messages: readonly StreamMessage[]) {
    for (const message of messages) {
      for (const listener of this.listeners) listener(message);
    }
  }

  get size() {
    return this.listeners.size;
  }
}
