// src/state-store/merge-strategies.ts
/**
 * Merge Strategies
 *
 * Different strategies for combining state values when
 * multiple SubAgents update the same key concurrently.
 */

import type { MergeStrategy } from "./types.js";

/**
 * Apply a merge strategy to combine current and new values.
 *
 * @param strategy - The merge strategy to apply
 * @param current - The current value
 * @param newValue - The new value to merge
 * @returns The merged result
 */
export function applyMergeStrategy(
  strategy: MergeStrategy,
  current: unknown,
  newValue: unknown,
): unknown {
  switch (strategy) {
    case "overwrite":
      return overwrite(current, newValue);

    case "append":
      return append(current, newValue);

    case "union":
      return union(current, newValue);

    case "merge":
      return deepMerge(current, newValue);

    default:
      // Default to overwrite for unknown strategies
      return newValue;
  }
}

/**
 * Overwrite: Simply replace current value with new value.
 * Use for: current window, mouse position, single-value state.
 */
function overwrite(_current: unknown, newValue: unknown): unknown {
  return newValue;
}

/**
 * Append: Concatenate arrays.
 * Use for: execution logs, event lists.
 */
function append(current: unknown, newValue: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(newValue)) {
    return [...current, ...newValue];
  }
  if (Array.isArray(newValue)) {
    return newValue;
  }
  if (Array.isArray(current)) {
    return current;
  }
  return newValue;
}

/**
 * Union: Combine as sets (unique values).
 * Use for: file lists, visited URLs.
 */
function union(current: unknown, newValue: unknown): unknown {
  const currentSet = toSet(current);
  const newSet = toSet(newValue);

  // Merge sets
  for (const item of newSet) {
    currentSet.add(item);
  }

  return currentSet;
}

/**
 * Deep Merge: Recursively merge objects.
 * Use for: complex state objects with nested properties.
 */
function deepMerge(current: unknown, newValue: unknown): unknown {
  // Handle null/undefined
  if (current === null || current === undefined) {
    return newValue;
  }
  if (newValue === null || newValue === undefined) {
    return current;
  }

  // Only merge plain objects
  if (isPlainObject(current) && isPlainObject(newValue)) {
    const result: Record<string, unknown> = { ...current };

    for (const key of Object.keys(newValue)) {
      const currentValue = current[key];
      const newV = newValue[key];

      if (isPlainObject(currentValue) && isPlainObject(newV)) {
        result[key] = deepMerge(currentValue, newV);
      } else {
        result[key] = newV;
      }
    }

    return result;
  }

  // For non-objects, new value wins
  return newValue;
}

/**
 * Convert value to Set.
 */
function toSet(value: unknown): Set<unknown> {
  if (value instanceof Set) {
    return new Set(value);
  }
  if (Array.isArray(value)) {
    return new Set(value);
  }
  if (value === null || value === undefined) {
    return new Set();
  }
  return new Set([value]);
}

/**
 * Check if value is a plain object (not array, not null).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Set)
  );
}
