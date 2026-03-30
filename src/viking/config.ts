// src/viking/config.ts
/**
 * Viking Configuration
 *
 * Default configuration and resolution for the Viking routing layer.
 */

import type { VikingConfig, IntentType } from "./types";

/**
 * Default Viking configuration using local Ollama with Qwen model.
 */
export const DEFAULT_VIKING_CONFIG: VikingConfig = {
  provider: "ollama",
  model: "qwen3.5:9b",
  endpoint: "http://localhost:11434",
  maxTokens: 512,
  timeoutMs: 3000,
  fallbackIntent: "chat",
};

/**
 * Resolves user-provided config with defaults.
 *
 * @param userConfig - Partial user configuration
 * @returns Complete VikingConfig with defaults applied
 */
export function resolveVikingConfig(userConfig?: Partial<VikingConfig>): VikingConfig {
  return { ...DEFAULT_VIKING_CONFIG, ...userConfig };
}

/**
 * Validates a VikingConfig object.
 *
 * @param config - Configuration to validate
 * @returns True if valid, throws error otherwise
 */
export function validateVikingConfig(config: VikingConfig): boolean {
  if (!config.model || config.model.trim() === "") {
    throw new Error("VikingConfig.model is required");
  }

  if (!config.endpoint || config.endpoint.trim() === "") {
    throw new Error("VikingConfig.endpoint is required");
  }

  if (config.maxTokens < 64 || config.maxTokens > 4096) {
    throw new Error("VikingConfig.maxTokens must be between 64 and 4096");
  }

  if (config.timeoutMs < 500 || config.timeoutMs > 30000) {
    throw new Error("VikingConfig.timeoutMs must be between 500 and 30000");
  }

  const validIntents: IntentType[] = ["file_ops", "gui_auto", "browser", "chat", "code"];
  if (!validIntents.includes(config.fallbackIntent)) {
    throw new Error(`VikingConfig.fallbackIntent must be one of: ${validIntents.join(", ")}`);
  }

  return true;
}