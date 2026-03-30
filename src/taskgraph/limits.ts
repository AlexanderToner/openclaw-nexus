// src/taskgraph/limits.ts
/**
 * Task Limits Checker
 *
 * Enforces hard limits on task execution to prevent runaway tasks
 * and ensure all tasks eventually terminate.
 */

import type { TaskGraph, TaskLimits } from "./types.js";

/**
 * Default task limits.
 * These values are chosen to:
 * - Cover 95% of normal tasks
 * - Catch anomalous behavior early
 * - Allow for complex multi-step operations
 */
export const DEFAULT_TASK_LIMITS: TaskLimits = {
  maxSteps: 50,
  maxTokens: 50000,
  maxReplans: 3,
  timeoutSeconds: undefined, // OFF by default - long tasks are common
};

/**
 * Error thrown when a task exceeds its limits.
 */
export class LimitExceededError extends Error {
  constructor(
    public readonly limitType: "steps" | "tokens" | "replans" | "timeout",
    public readonly current: number,
    public readonly max: number,
  ) {
    super(`Task exceeded ${limitType} limit: ${current}/${max}`);
    this.name = "LimitExceededError";
  }
}

/**
 * TaskLimitsChecker monitors and enforces task limits.
 *
 * Usage:
 * ```typescript
 * const checker = new TaskLimitsChecker(limits);
 * if (checker.isStepsExceeded(graph)) {
 *   throw new LimitExceededError("steps", graph.currentStepIndex, limits.maxSteps);
 * }
 * ```
 */
export class TaskLimitsChecker {
  private limits: TaskLimits;
  private startTime: number;
  private tokenCount: number = 0;

  constructor(limits: TaskLimits = DEFAULT_TASK_LIMITS) {
    this.limits = limits;
    this.startTime = Date.now();
  }

  /**
   * Check if step count exceeds limit.
   */
  isStepsExceeded(graph: TaskGraph): boolean {
    return graph.currentStepIndex >= this.limits.maxSteps;
  }

  /**
   * Check if replan count exceeds limit.
   */
  isReplansExceeded(graph: TaskGraph): boolean {
    return graph.replanCount >= this.limits.maxReplans;
  }

  /**
   * Check if token count exceeds limit.
   */
  isTokensExceeded(): boolean {
    return this.tokenCount >= this.limits.maxTokens;
  }

  /**
   * Check if timeout has been exceeded.
   * Returns false if timeout is not set (undefined).
   */
  isTimeoutExceeded(): boolean {
    if (this.limits.timeoutSeconds === undefined) {
      return false;
    }
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    return elapsedSeconds >= this.limits.timeoutSeconds;
  }

  /**
   * Check all limits at once.
   * Returns the first exceeded limit, or null if all OK.
   */
  checkAll(graph: TaskGraph): LimitExceededError | null {
    if (this.isStepsExceeded(graph)) {
      return new LimitExceededError("steps", graph.currentStepIndex, this.limits.maxSteps);
    }

    if (this.isReplansExceeded(graph)) {
      return new LimitExceededError("replans", graph.replanCount, this.limits.maxReplans);
    }

    if (this.isTokensExceeded()) {
      return new LimitExceededError("tokens", this.tokenCount, this.limits.maxTokens);
    }

    if (this.isTimeoutExceeded()) {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      return new LimitExceededError("timeout", elapsed, this.limits.timeoutSeconds!);
    }

    return null;
  }

  /**
   * Add tokens to the counter.
   */
  addTokens(count: number): void {
    this.tokenCount += count;
  }

  /**
   * Get current token count.
   */
  getTokenCount(): number {
    return this.tokenCount;
  }

  /**
   * Get elapsed time in seconds.
   */
  getElapsedSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Get the configured limits.
   */
  getLimits(): TaskLimits {
    return { ...this.limits };
  }

  /**
   * Reset the checker for a new task.
   */
  reset(): void {
    this.startTime = Date.now();
    this.tokenCount = 0;
  }
}
