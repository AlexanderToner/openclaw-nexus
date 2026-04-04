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
  maxTokens: 128, // Short response needed - just JSON
  timeoutMs: 30_000, // 30s for local model response
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
    return `<|im_start|>system
You are an intent classifier. You MUST output ONLY valid JSON. No explanation, no thinking, no other text.

Examples:
User: 你好
Assistant: {"intent":"chat","requiredTools":[],"requiredFiles":[],"requiredSkills":[],"contextSizeHint":"minimal","confidence":0.95}
User: 列出文件
Assistant: {"intent":"file_ops","requiredTools":["read"],"requiredFiles":[],"requiredSkills":[],"contextSizeHint":"minimal","confidence":0.9}
User: 帮我写代码
Assistant: {"intent":"code","requiredTools":["write"],"requiredFiles":[],"requiredSkills":[],"contextSizeHint":"normal","confidence":0.85}
User: 浏览网页
Assistant: {"intent":"browser","requiredTools":["browser"],"requiredFiles":[],"requiredSkills":[],"contextSizeHint":"normal","confidence":0.9}
User: 自动点击
Assistant: {"intent":"gui_auto","requiredTools":[],"requiredFiles":[],"requiredSkills":[],"contextSizeHint":"normal","confidence":0.8}

JSON schema:
{"intent":"file_ops|gui_auto|browser|chat|code","requiredTools":[],"requiredFiles":[],"requiredSkills":[],"contextSizeHint":"minimal|normal|full","confidence":0.0-1.0}

Intent: file_ops=文件操作, gui_auto=桌面GUI自动化, browser=浏览器自动化, chat=对话, code=代码
<|im_end|>
<|im_start|>user
Classify: ${message}
<|im_end|>
<|im_start|>assistant
`;
  }
}
