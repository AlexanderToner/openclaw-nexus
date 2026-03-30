// src/viking/types.ts
/**
 * Viking Router Types
 *
 * Lightweight routing layer for intent classification and context filtering.
 */

export type IntentType = "file_ops" | "gui_auto" | "browser" | "chat" | "code";
export type ContextSizeHint = "minimal" | "normal" | "full";

/**
 * RouteDecision represents the output of Viking's intent classification.
 * It determines what tools, files, and skills are needed for a user request.
 */
export interface RouteDecision {
  /** Classified intent type */
  intent: IntentType;

  /** List of tool names required for this request */
  requiredTools: string[];

  /** List of file paths/sections that should be loaded */
  requiredFiles: string[];

  /** List of skills that should be activated */
  requiredSkills: string[];

  /** Hint for how much context to load */
  contextSizeHint: ContextSizeHint;

  /** Confidence score of the classification (0.0 - 1.0) */
  confidence: number;
}

/**
 * VikingConfig configures the lightweight LLM used for routing.
 */
export interface VikingConfig {
  /** LLM provider */
  provider: "ollama" | "openai" | "anthropic";

  /** Model identifier */
  model: string;

  /** API endpoint URL */
  endpoint: string;

  /** Maximum tokens for routing response */
  maxTokens: number;

  /** Timeout for routing request in milliseconds */
  timeoutMs: number;

  /** Default intent when classification fails */
  fallbackIntent: IntentType;
}

/**
 * ContextFilterResult represents the filtered context after routing.
 */
export interface ContextFilterResult {
  /** Filtered list of tools to load */
  tools: string[];

  /** Filtered list of files/sections to load */
  files: string[];

  /** Filtered list of skills to activate */
  skills: string[];

  /** Estimated token savings percentage */
  tokenSavingsPercent: number;
}