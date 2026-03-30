// src/state-store/types.ts
/**
 * Global State Store Types
 *
 * Types for cross-SubAgent state sharing with version control.
 * Enables communication between isolated SubAgents without
 * passing full conversation context.
 */

/**
 * StateEntry represents a single value in the state store.
 */
export interface StateEntry {
  /** The stored value */
  value: unknown;

  /** Version number for optimistic locking */
  version: number;

  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * StateClient provides the interface for SubAgents to interact
 * with the global state store.
 */
export interface StateClient {
  /**
   * Get a value from the store.
   * @returns The value and version, or null if not found
   */
  get(key: string): Promise<{ value: unknown; version: number } | null>;

  /**
   * Set a value in the store.
   * @param expectedVersion - If provided, only set if current version matches (optimistic lock)
   * @returns true if successful, false if version mismatch
   */
  set(key: string, value: unknown, expectedVersion?: number): Promise<boolean>;

  /**
   * Update a value using an updater function.
   * Automatically handles retries on version conflicts.
   * @returns The new version number
   */
  update(
    key: string,
    updater: (current: unknown) => unknown,
    options?: UpdateOptions,
  ): Promise<number>;

  /**
   * Subscribe to changes on a key.
   * @returns Unsubscribe function
   */
  subscribe(key: string, callback: (value: unknown) => void): () => void;

  /**
   * Delete a key from the store.
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all keys matching a pattern.
   */
  listKeys(pattern?: string): Promise<string[]>;
}

/**
 * Options for update operations.
 */
export interface UpdateOptions {
  /** Maximum number of retries on version conflict (default: 3) */
  maxRetries?: number;

  /** Strategy for merging values */
  mergeStrategy?: MergeStrategy;
}

/**
 * Merge strategies for concurrent updates.
 */
export type MergeStrategy = "overwrite" | "append" | "union" | "merge";

/**
 * State scope determines the lifecycle of stored values.
 */
export type StateScope = "task" | "session" | "global";

/**
 * Configuration for the state store.
 */
export interface StateStoreConfig {
  /** Default scope for new keys */
  defaultScope: StateScope;

  /** Maximum number of keys to store */
  maxKeys: number;

  /** TTL for keys in milliseconds (0 = no expiry) */
  defaultTtlMs: number;
}

/**
 * Statistics about the state store.
 */
export interface StateStoreStats {
  /** Total number of keys */
  keyCount: number;

  /** Total estimated memory usage in bytes */
  estimatedSize: number;

  /** Number of version conflicts encountered */
  versionConflicts: number;

  /** Number of subscriptions */
  subscriptionCount: number;
}
