// src/viking/index.ts
/**
 * Viking Router Module
 *
 * Lightweight routing layer for intent classification and context filtering.
 * Reduces token consumption by 50-80% by loading only necessary context.
 */

export * from "./types";
export * from "./config";
export * from "./intent-classifier";
export * from "./context-filter";
export * from "./router";