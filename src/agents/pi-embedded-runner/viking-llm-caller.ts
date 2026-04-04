// src/agents/pi-embedded-runner/viking-llm-caller.ts
/**
 * Viking LLM Caller
 *
 * Lightweight LLM caller for Viking Router intent classification.
 * Uses Ollama API to call local models (e.g., qwen3.5:9b).
 */

import type { VikingConfig } from "../../config/types.agent-defaults.js";
import type { RouteDecision, IntentType } from "../../viking/types.js";
import { log } from "./logger.js";

export type VikingLlmCallerConfig = {
  /** Provider (ollama, openai, anthropic) */
  provider: "ollama" | "openai" | "anthropic";
  /** Model ID */
  modelId: string;
  /** API endpoint */
  endpoint?: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Fallback intent when classification fails */
  fallbackIntent?: IntentType;
};

const DEFAULT_CONFIG: Required<Omit<VikingLlmCallerConfig, "endpoint">> & { endpoint: string } = {
  provider: "ollama",
  modelId: "qwen3.5:2b",
  endpoint: "http://localhost:11434",
  maxTokens: 128,
  timeoutMs: 30_000,
  fallbackIntent: "chat",
};

/**
 * Create a Viking LLM caller from config.
 */
export function createVikingLlmCaller(
  config?: VikingConfig,
): (prompt: string) => Promise<RouteDecision> {
  const mergedConfig: VikingLlmCallerConfig = {
    provider: config?.model?.provider ?? DEFAULT_CONFIG.provider,
    modelId: config?.model?.modelId ?? DEFAULT_CONFIG.modelId,
    endpoint: config?.model?.endpoint ?? DEFAULT_CONFIG.endpoint,
    maxTokens: config?.model?.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    timeoutMs: config?.model?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    fallbackIntent: config?.fallbackIntent ?? DEFAULT_CONFIG.fallbackIntent,
  };

  return async (prompt: string): Promise<RouteDecision> => {
    return callVikingLlm(prompt, mergedConfig);
  };
}

/**
 * Call the Viking LLM and parse the response.
 */
async function callVikingLlm(
  prompt: string,
  config: VikingLlmCallerConfig,
): Promise<RouteDecision> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs;
  const startTime = Date.now();

  try {
    log.debug(
      `[viking-llm] calling model=${config.modelId} endpoint=${config.endpoint} promptLen=${prompt.length}`,
    );
    const response = await callWithTimeout(() => callOllama(prompt, config), timeoutMs);
    const duration = Date.now() - startTime;
    log.debug(`[viking-llm] response received len=${response.length} duration=${duration}ms`);

    log.debug(`[viking-llm] raw response: ${response.slice(0, 500)}`);
    const decision = parseRouteDecision(
      response,
      config.fallbackIntent ?? DEFAULT_CONFIG.fallbackIntent,
    );
    log.info(
      `[viking-llm] decision: intent=${decision.intent} conf=${decision.confidence.toFixed(2)} tools=${decision.requiredTools.length} files=${decision.requiredFiles.length} hint=${decision.contextSizeHint}`,
    );

    return decision;
  } catch (err) {
    const duration = Date.now() - startTime;
    log.warn(`[viking-llm] call failed: ${String(err)} duration=${duration}ms`);
    // Return fallback decision on any error
    return createFallbackDecision(config.fallbackIntent ?? DEFAULT_CONFIG.fallbackIntent);
  }
}

/**
 * Call Ollama API.
 */
async function callOllama(prompt: string, config: VikingLlmCallerConfig): Promise<string> {
  const endpoint = config.endpoint ?? DEFAULT_CONFIG.endpoint;
  const model = config.modelId ?? DEFAULT_CONFIG.modelId;
  const maxTokens = config.maxTokens ?? DEFAULT_CONFIG.maxTokens;

  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json", // Force JSON output
      options: {
        num_predict: maxTokens,
        temperature: 0.1, // Low temperature for consistent classification
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  // qwen3.5 outputs JSON in thinking field even with format:json
  let text = (data.response as string) || "";
  const thinking = data.thinking as string | undefined;

  if (!text && thinking) {
    // Try to extract JSON from thinking field
    const jsonMatch = thinking.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
      log.debug(`[viking-llm] extracted JSON from thinking field, len=${text.length}`);
    } else {
      text = thinking;
    }
  }
  return text;
}

/**
 * Parse the LLM response into a RouteDecision.
 */
function parseRouteDecision(response: string, fallbackIntent: IntentType): RouteDecision {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return createFallbackDecision(fallbackIntent);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<RouteDecision>;

    // Validate and normalize the parsed result
    const intent = normalizeIntent(parsed.intent, fallbackIntent);
    const confidence = normalizeConfidence(parsed.confidence);

    return {
      intent,
      requiredTools: parsed.requiredTools ?? [],
      requiredFiles: parsed.requiredFiles ?? [],
      requiredSkills: parsed.requiredSkills ?? [],
      contextSizeHint: normalizeContextSizeHint(parsed.contextSizeHint),
      confidence,
    };
  } catch {
    return createFallbackDecision(fallbackIntent);
  }
}

/**
 * Normalize intent type.
 */
function normalizeIntent(intent: unknown, fallback: IntentType): IntentType {
  const validIntents: IntentType[] = ["file_ops", "gui_auto", "browser", "chat", "code"];
  if (typeof intent === "string" && validIntents.includes(intent as IntentType)) {
    return intent as IntentType;
  }
  return fallback;
}

/**
 * Normalize confidence value.
 */
function normalizeConfidence(confidence: unknown): number {
  if (typeof confidence === "number" && confidence >= 0 && confidence <= 1) {
    return confidence;
  }
  return 0.5;
}

/**
 * Normalize context size hint.
 */
function normalizeContextSizeHint(hint: unknown): "minimal" | "normal" | "full" {
  const validHints = ["minimal", "normal", "full"] as const;
  if (typeof hint === "string" && validHints.includes(hint as "minimal" | "normal" | "full")) {
    return hint as "minimal" | "normal" | "full";
  }
  return "minimal";
}

/**
 * Create a fallback decision.
 */
function createFallbackDecision(fallbackIntent: IntentType): RouteDecision {
  return {
    intent: fallbackIntent,
    requiredTools: [],
    requiredFiles: [],
    requiredSkills: [],
    contextSizeHint: "minimal",
    confidence: 0.3,
  };
}

/**
 * Call with timeout.
 */
async function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Viking LLM call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
