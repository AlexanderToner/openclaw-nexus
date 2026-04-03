// src/viking/intent-classifier.ts
/**
 * Intent Classifier
 *
 * Uses a lightweight LLM to classify user intent and determine
 * what tools, files, and skills are needed for a request.
 */

import type { RouteDecision } from "./types.js";

export type LlmCaller = (prompt: string) => Promise<RouteDecision>;

interface ClassifierConfig {
  maxTokens: number;
  timeoutMs: number;
}

const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  maxTokens: 512,
  timeoutMs: 15_000, // 15s for local model cold starts (qwen3.5:9b)
};

/**
 * IntentClassifier analyzes user messages and determines:
 * - The type of intent (file_ops, gui_auto, browser, chat, code)
 * - Required tools for the operation
 * - Files that need to be loaded
 * - Skills that should be activated
 * - How much context is needed
 */
export class IntentClassifier {
  private llm: LlmCaller;
  private config: ClassifierConfig;

  constructor(llm: LlmCaller, config?: Partial<ClassifierConfig>) {
    this.llm = llm;
    this.config = { ...DEFAULT_CLASSIFIER_CONFIG, ...config };
  }

  /**
   * Classify a user message to determine intent and required context.
   *
   * @param userMessage - The user's request/message
   * @returns RouteDecision with classified intent and requirements
   */
  async classify(userMessage: string): Promise<RouteDecision> {
    const prompt = this.buildPrompt(userMessage);
    return this.llm(prompt);
  }

  /**
   * Build the classification prompt for the LLM.
   */
  private buildPrompt(message: string): string {
    return `You are an intent classifier. Analyze the user message and output JSON.

User message: "${message}"

Output ONLY valid JSON with these fields:
{
  "intent": "file_ops" | "gui_auto" | "browser" | "chat" | "code",
  "requiredTools": ["tool1", "tool2"],
  "requiredFiles": ["file1", "file2"],
  "requiredSkills": ["skill1"],
  "contextSizeHint": "minimal" | "normal" | "full",
  "confidence": 0.95
}

Intent definitions:
- file_ops: File/directory operations (read, write, move, delete, list)
- gui_auto: Native desktop GUI automation (click, type, scroll)
- browser: Web browser automation (navigate, click, extract)
- chat: Simple conversation/questions needing no tools
- code: Code analysis, generation, or modification

Rules:
- requiredTools: List specific tool names needed (e.g., "fs_read", "gui_click", "browser_navigate")
- requiredFiles: List file paths or sections that should be loaded
- contextSizeHint: "minimal" for simple tasks, "normal" for moderate, "full" for complex
- confidence: 0.0-1.0 indicating how certain the classification is

JSON output only, no explanation.`;
  }
}
