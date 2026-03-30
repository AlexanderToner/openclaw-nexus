// src/viking/router.ts
/**
 * Viking Router
 *
 * Main entry point for the Viking routing layer.
 * Combines intent classification with context filtering
 * to minimize token consumption.
 */

import type { RouteDecision, ContextFilterResult, IntentType } from "./types";
import type { IntentClassifier } from "./intent-classifier";
import type { ContextFilter } from "./context-filter";

export interface RouterResult {
  /** The routing decision from intent classification */
  decision: RouteDecision;

  /** The filtered context to load */
  filteredContext: ContextFilterResult;

  /** Whether routing succeeded or used fallback */
  success: boolean;
}

export interface RouterOptions {
  /** Fallback intent when classification fails */
  fallbackIntent: IntentType;
}

const DEFAULT_ROUTER_OPTIONS: RouterOptions = {
  fallbackIntent: "chat",
};

/**
 * VikingRouter orchestrates the routing process:
 * 1. Classify user intent using lightweight LLM
 * 2. Filter context based on classification
 * 3. Return minimal context needed for the request
 *
 * This reduces token consumption by 50-80% compared to
 * loading full context for every request.
 */
export class VikingRouter {
  private classifier: IntentClassifier;
  private filter: ContextFilter;
  private options: RouterOptions;

  constructor(
    classifier: IntentClassifier,
    filter: ContextFilter,
    options?: Partial<RouterOptions>
  ) {
    this.classifier = classifier;
    this.filter = filter;
    this.options = { ...DEFAULT_ROUTER_OPTIONS, ...options };
  }

  /**
   * Route a user message to determine intent and filtered context.
   *
   * @param userMessage - The user's request/message
   * @param availableContext - Available tools, files, and skills
   * @returns RouterResult with decision and filtered context
   */
  async route(
    userMessage: string,
    availableContext?: {
      tools: string[];
      files: string[];
      skills: string[];
    }
  ): Promise<RouterResult> {
    let decision: RouteDecision;
    let success = true;

    // Step 1: Classify intent
    try {
      decision = await this.classifier.classify(userMessage);
    } catch (error) {
      // Fallback on classification failure
      decision = this.createFallbackDecision();
      success = false;
    }

    // Step 2: Filter context (use empty if not provided)
    const context = availableContext ?? { tools: [], files: [], skills: [] };
    const filteredContext = this.filter.applyFilters(context, decision);

    return {
      decision,
      filteredContext,
      success,
    };
  }

  /**
   * Create a fallback decision when classification fails.
   */
  private createFallbackDecision(): RouteDecision {
    return {
      intent: this.options.fallbackIntent,
      requiredTools: [],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.3, // Low confidence for fallback
    };
  }
}