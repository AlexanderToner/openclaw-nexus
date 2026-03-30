// src/state-store/store.ts
/**
 * Global State Store
 *
 * Provides cross-SubAgent state sharing with version control,
 * event subscriptions, and merge strategies.
 */

import { applyMergeStrategy } from "./merge-strategies.js";
import type {
  StateEntry,
  StateClient,
  StateScope,
  StateStoreConfig,
  StateStoreStats,
  UpdateOptions,
} from "./types.js";

const DEFAULT_CONFIG: StateStoreConfig = {
  defaultScope: "task",
  maxKeys: 10000,
  defaultTtlMs: 0, // No expiry
};

/**
 * GlobalStateStore implements a shared state store for SubAgents.
 *
 * Features:
 * - Version control with optimistic locking
 * - Event subscriptions
 * - Multiple merge strategies
 * - Scope-based lifecycle
 */
export class GlobalStateStore implements StateClient {
  private store: Map<string, StateEntry> = new Map();
  private subscriptions: Map<string, Set<(value: unknown) => void>> = new Map();
  private config: StateStoreConfig;
  private stats: StateStoreStats;

  constructor(config?: Partial<StateStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      keyCount: 0,
      estimatedSize: 0,
      versionConflicts: 0,
      subscriptionCount: 0,
    };
  }

  /**
   * Get a value from the store.
   */
  async get(key: string): Promise<{ value: unknown; version: number } | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    return {
      value: entry.value,
      version: entry.version,
    };
  }

  /**
   * Set a value in the store.
   */
  async set(key: string, value: unknown, expectedVersion?: number): Promise<boolean> {
    const current = this.store.get(key);

    // Check optimistic lock
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      this.stats.versionConflicts++;
      return false;
    }

    const newVersion = current ? current.version + 1 : 1;
    const entry: StateEntry = {
      value,
      version: newVersion,
      updatedAt: Date.now(),
    };

    this.store.set(key, entry);
    this.updateStats();

    // Notify subscribers
    this.notifySubscribers(key, value);

    return true;
  }

  /**
   * Update a value using an updater function.
   */
  async update(
    key: string,
    updater: (current: unknown) => unknown,
    options?: UpdateOptions,
  ): Promise<number> {
    const maxRetries = options?.maxRetries ?? 3;
    const mergeStrategy = options?.mergeStrategy ?? "overwrite";

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const current = await this.get(key);
      const currentValue = current?.value;
      const currentVersion = current?.version ?? 0;

      // Apply updater or merge strategy
      let newValue: unknown;
      if (mergeStrategy !== "overwrite" && currentValue !== null) {
        // For merge strategies, we need the value from updater
        const updatedValue = updater(currentValue);
        newValue = applyMergeStrategy(mergeStrategy, currentValue, updatedValue);
      } else {
        newValue = updater(currentValue);
      }

      const success = await this.set(key, newValue, currentVersion);
      if (success) {
        return currentVersion + 1;
      }

      // Version conflict - retry
      this.stats.versionConflicts++;
    }

    throw new Error(`Failed to update key '${key}' after ${maxRetries} retries`);
  }

  /**
   * Subscribe to changes on a key.
   */
  subscribe(key: string, callback: (value: unknown) => void): () => void {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }

    const subs = this.subscriptions.get(key)!;
    subs.add(callback);
    this.stats.subscriptionCount++;

    // Return unsubscribe function
    return () => {
      subs.delete(callback);
      this.stats.subscriptionCount--;
    };
  }

  /**
   * Delete a key from the store.
   */
  async delete(key: string): Promise<boolean> {
    const existed = this.store.delete(key);
    if (existed) {
      this.updateStats();
      this.notifySubscribers(key, undefined);
    }
    return existed;
  }

  /**
   * List all keys matching a pattern.
   */
  async listKeys(pattern?: string): Promise<string[]> {
    const keys = Array.from(this.store.keys());

    if (!pattern) {
      return keys;
    }

    // Simple glob pattern matching
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");

    return keys.filter((k) => regex.test(k));
  }

  /**
   * Get store statistics.
   */
  getStats(): StateStoreStats {
    return { ...this.stats };
  }

  /**
   * Clear all entries (for task/session scope cleanup).
   */
  clear(scope?: StateScope): void {
    if (!scope) {
      this.store.clear();
      this.subscriptions.clear();
      this.stats.keyCount = 0;
      this.stats.subscriptionCount = 0;
      return;
    }

    // For scoped clearing, we'd need to track scope per key
    // This is a simplified implementation
    this.store.clear();
    this.updateStats();
  }

  /**
   * Notify subscribers of a change.
   */
  private notifySubscribers(key: string, value: unknown): void {
    const subs = this.subscriptions.get(key);
    if (!subs) {
      return;
    }

    for (const callback of subs) {
      try {
        callback(value);
      } catch (error) {
        console.error(`[StateStore] Subscriber error for key '${key}':`, error);
      }
    }
  }

  /**
   * Update statistics.
   */
  private updateStats(): void {
    this.stats.keyCount = this.store.size;

    // Rough estimate of memory usage
    let size = 0;
    for (const [key, entry] of this.store) {
      size += key.length * 2; // UTF-16 characters
      size += JSON.stringify(entry.value).length;
    }
    this.stats.estimatedSize = size;
  }
}
