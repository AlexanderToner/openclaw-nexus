// src/taskgraph/replanner.ts
/**
 * Partial Replanner
 *
 * Handles partial replanning when steps fail during execution.
 * Analyzes failure context and generates recovery steps.
 */

import { TaskGraphPlanner, type LlmPlannerFn } from "./planner.js";
import type { TaskGraph, Step } from "./types.js";

/**
 * Failure analysis result.
 */
export interface FailureAnalysis {
  /** Type of failure */
  type: FailureType;

  /** Whether the failure is recoverable */
  recoverable: boolean;

  /** Suggested recovery approach */
  recoveryApproach?: string;

  /** Steps to retry */
  retrySteps?: string[];

  /** Context for LLM replan prompt */
  context: string;
}

export type FailureType =
  | "resource_not_found"
  | "permission_denied"
  | "timeout"
  | "dependency_failed"
  | "unexpected_error"
  | "security_blocked";

/**
 * ReplanStrategy determines how to recover from failure.
 */
export type ReplanStrategy =
  | "retry_same_step"
  | "skip_and_continue"
  | "alternative_approach"
  | "request_user_input"
  | "abort";

/**
 * PartialReplanner handles failure recovery and partial replanning.
 */
export class PartialReplanner {
  private planner: TaskGraphPlanner;
  private maxRetries: number;

  constructor(llmPlanner: LlmPlannerFn, maxRetries = 3) {
    this.planner = new TaskGraphPlanner(llmPlanner);
    this.maxRetries = maxRetries;
  }

  /**
   * Analyze a failure and determine recovery strategy.
   *
   * @param graph - Current TaskGraph
   * @param failedStepId - ID of the failed step
   * @param error - Error message
   * @returns Failure analysis with recovery suggestions
   */
  analyzeFailure(graph: TaskGraph, failedStepId: string, error: string): FailureAnalysis {
    const failedStep = graph.steps.find((s) => s.id === failedStepId);
    if (!failedStep) {
      return {
        type: "unexpected_error",
        recoverable: false,
        context: `Unknown step ${failedStepId} failed: ${error}`,
      };
    }

    // Classify failure type
    const failureType = this.classifyFailure(error);
    const recoverable = this.isRecoverable(failureType, graph.replanCount);

    // Generate context for replanning
    const context = this.buildFailureContext(graph, failedStep, error, failureType);

    // Determine recovery approach
    const recoveryApproach = this.determineRecoveryApproach(failureType, recoverable);

    return {
      type: failureType,
      recoverable,
      recoveryApproach,
      retrySteps: recoverable ? [failedStepId] : undefined,
      context,
    };
  }

  /**
   * Generate recovery TaskGraph.
   *
   * @param graph - Current TaskGraph
   * @param completedSteps - Successfully completed step IDs
   * @param failedStepId - ID of the failed step
   * @param error - Error message
   * @returns New TaskGraph with recovery steps
   */
  async generateRecovery(
    graph: TaskGraph,
    completedSteps: string[],
    failedStepId: string,
    error: string,
  ): Promise<TaskGraph> {
    // Check replan limits
    if (graph.replanCount >= graph.limits.maxReplans) {
      return {
        ...graph,
        status: "failed",
      };
    }

    // Use planner's replan method
    return this.planner.replan(graph, completedSteps, failedStepId, error);
  }

  /**
   * Determine if automatic retry is appropriate.
   *
   * @param failureType - Type of failure
   * @param error - Error message
   * @returns Whether to automatically retry
   */
  shouldAutoRetry(failureType: FailureType, error: string): boolean {
    // Auto-retry for transient failures
    const transientIndicators = [
      "timeout",
      "temporarily unavailable",
      "rate limit",
      "connection reset",
      "ECONNRESET",
      "ETIMEDOUT",
    ];

    const lowerError = error.toLowerCase();
    return transientIndicators.some((indicator) => lowerError.includes(indicator.toLowerCase()));
  }

  /**
   * Classify failure type from error message.
   */
  private classifyFailure(error: string): FailureType {
    const lowerError = error.toLowerCase();

    if (lowerError.includes("not found") || lowerError.includes("enoent")) {
      return "resource_not_found";
    }

    if (
      lowerError.includes("permission") ||
      lowerError.includes("eacces") ||
      lowerError.includes("denied")
    ) {
      return "permission_denied";
    }

    if (
      lowerError.includes("timeout") ||
      lowerError.includes("timed out") ||
      lowerError.includes("etimedout")
    ) {
      return "timeout";
    }

    if (lowerError.includes("dependency") || lowerError.includes("depends on")) {
      return "dependency_failed";
    }

    if (lowerError.includes("security") || lowerError.includes("blocked")) {
      return "security_blocked";
    }

    return "unexpected_error";
  }

  /**
   * Check if failure is recoverable.
   */
  private isRecoverable(failureType: FailureType, replanCount: number): boolean {
    // Check replan limit
    if (replanCount >= this.maxRetries) {
      return false;
    }

    // Some failure types are never recoverable
    if (failureType === "security_blocked") {
      return false;
    }

    return true;
  }

  /**
   * Build failure context for LLM.
   */
  private buildFailureContext(
    graph: TaskGraph,
    failedStep: Step,
    error: string,
    failureType: FailureType,
  ): string {
    const sections = [
      `## Original Goal\n${graph.goal}`,
      `## Failed Step\n- ID: ${failedStep.id}\n- Type: ${failedStep.type}\n- Description: ${failedStep.desc}`,
      `## Failure Type\n${failureType}`,
      `## Error Message\n${error}`,
      `## Remaining Replans\n${graph.limits.maxReplans - graph.replanCount}`,
    ];

    return sections.join("\n\n");
  }

  /**
   * Determine recovery approach based on failure type.
   */
  private determineRecoveryApproach(failureType: FailureType, recoverable: boolean): string {
    if (!recoverable) {
      return "abort";
    }

    switch (failureType) {
      case "timeout":
        return "retry_same_step";

      case "resource_not_found":
        return "alternative_approach";

      case "permission_denied":
        return "request_user_input";

      case "dependency_failed":
        return "retry_same_step";

      case "security_blocked":
        return "abort";

      default:
        return "alternative_approach";
    }
  }
}
