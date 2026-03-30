// src/taskgraph/executor.ts
/**
 * TaskGraph Executor
 *
 * Executes TaskGraph steps sequentially, tracking progress and handling errors.
 * Integrates with Security Arbiter for pre-execution checks.
 */

import type { SecurityArbiter } from "../security/arbiter.js";
import { AssertionEngine } from "./assertion-engine.js";
import { TaskLimitsChecker } from "./limits.js";
import { TaskGraphStore } from "./store.js";
import type { TaskGraph, Step, StepType } from "./types.js";

/**
 * SubAgent executor function type.
 */
export type SubAgentExecutorFn = (step: Step, context: ExecutionContext) => Promise<StepResult>;

/**
 * Execution context passed to SubAgents.
 */
export interface ExecutionContext {
  taskId: string;
  workingDir: string;
  state: Map<string, unknown>;
  securityArbiter?: SecurityArbiter;
}

/**
 * Result from step execution.
 */
export interface StepResult {
  stepId: string;
  status: StepResultStatus;
  output?: unknown;
  error?: StepError;
  stateUpdates?: Record<string, unknown>;
}

export type StepResultStatus = "success" | "failed" | "skipped";

/**
 * Step execution error.
 */
export interface StepError {
  type: ErrorType;
  message: string;
  retryable: boolean;
}

export type ErrorType = "security_blocked" | "timeout" | "execution_error" | "dependency_failed";

/**
 * Execution options.
 */
export interface ExecutionOptions {
  /** Stop on first failure */
  stopOnFailure?: boolean;

  /** Skip security checks */
  skipSecurity?: boolean;

  /** Progress callback */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: "step_started"; stepId: string; stepIndex: number; totalSteps: number }
  | { type: "step_completed"; stepId: string; status: StepResultStatus }
  | { type: "goal_checking" }
  | { type: "goal_passed" }
  | { type: "goal_failed"; reason: string };

/**
 * Execution result.
 */
export interface ExecutionResult {
  taskId: string;
  status: "completed" | "failed" | "partial";
  completedSteps: string[];
  failedSteps: string[];
  goalPassed: boolean;
  goalReason?: string;
  error?: StepError;
}

/**
 * TaskGraphExecutor executes TaskGraphs step by step.
 */
export class TaskGraphExecutor {
  private store: TaskGraphStore;
  private assertionEngine: AssertionEngine;
  private agentExecutors: Map<StepType, SubAgentExecutorFn>;
  private securityArbiter?: SecurityArbiter;

  constructor(
    store: TaskGraphStore,
    agentExecutors: Map<StepType, SubAgentExecutorFn>,
    securityArbiter?: SecurityArbiter,
  ) {
    this.store = store;
    this.assertionEngine = new AssertionEngine();
    this.agentExecutors = agentExecutors;
    this.securityArbiter = securityArbiter;
  }

  /**
   * Execute a TaskGraph.
   *
   * @param graph - The TaskGraph to execute
   * @param options - Execution options
   * @returns Execution result
   */
  async execute(graph: TaskGraph, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const { stopOnFailure = true, skipSecurity = false, onProgress } = options;

    // Update status to running
    graph.status = "running";
    await this.store.save(graph);

    const completedSteps: string[] = [];
    const failedSteps: string[] = [];
    const state = new Map<string, unknown>();

    // Check initial limits
    const limitsChecker = new TaskLimitsChecker(graph.limits);
    const limitsError = limitsChecker.checkAll(graph);
    if (limitsError) {
      return {
        taskId: graph.taskId,
        status: "failed",
        completedSteps,
        failedSteps,
        goalPassed: false,
        goalReason: limitsError.message,
        error: { type: "execution_error", message: limitsError.message, retryable: false },
      };
    }

    // Execute steps
    for (let i = graph.currentStepIndex; i < graph.steps.length; i++) {
      const step = graph.steps[i];

      // Check if dependencies are met
      const depsMet = this.checkDependencies(step, completedSteps);
      if (!depsMet) {
        failedSteps.push(step.id);
        if (stopOnFailure) {
          break;
        }
        continue;
      }

      // Update progress
      onProgress?.({
        type: "step_started",
        stepId: step.id,
        stepIndex: i,
        totalSteps: graph.steps.length,
      });

      // Security check
      if (!skipSecurity && this.securityArbiter) {
        const securityResult = await this.checkSecurity(step);
        if (!securityResult.allowed) {
          failedSteps.push(step.id);
          if (stopOnFailure) {
            await this.store.updateStatus(graph.taskId, "failed");
            return {
              taskId: graph.taskId,
              status: "failed",
              completedSteps,
              failedSteps,
              goalPassed: false,
              goalReason: `Security blocked: ${securityResult.reason}`,
              error: {
                type: "security_blocked",
                message: securityResult.reason ?? "Security blocked",
                retryable: false,
              },
            };
          }
          continue;
        }
      }

      // Execute step
      const result = await this.executeStep(step, graph, state);

      onProgress?.({ type: "step_completed", stepId: step.id, status: result.status });

      if (result.status === "success") {
        completedSteps.push(step.id);

        // Apply state updates
        if (result.stateUpdates) {
          for (const [key, value] of Object.entries(result.stateUpdates)) {
            state.set(key, value);
          }
        }

        // Update progress
        graph.currentStepIndex = i + 1;
        await this.store.updateStepIndex(graph.taskId, i + 1);
      } else {
        failedSteps.push(step.id);
        if (stopOnFailure) {
          break;
        }
      }

      // Check limits after each step
      limitsChecker.addTokens(0); // Track step
      const currentLimitsError = limitsChecker.checkAll(graph);
      if (currentLimitsError) {
        await this.store.updateStatus(graph.taskId, "failed");
        return {
          taskId: graph.taskId,
          status: "failed",
          completedSteps,
          failedSteps,
          goalPassed: false,
          goalReason: currentLimitsError.message,
          error: { type: "execution_error", message: currentLimitsError.message, retryable: false },
        };
      }
    }

    // Check goal assertion
    onProgress?.({ type: "goal_checking" });
    const goalPassed = await this.assertionEngine.evaluate(graph.goalAssertion);
    const goalReason = goalPassed
      ? "Goal assertion passed"
      : `Goal assertion failed: ${graph.goalAssertion.description}`;

    onProgress?.({ type: goalPassed ? "goal_passed" : "goal_failed", reason: goalReason });

    // Determine final status
    let status: ExecutionResult["status"];
    if (goalPassed) {
      status = "completed";
      await this.store.updateStatus(graph.taskId, "completed");
    } else if (failedSteps.length > 0) {
      status = "failed";
      await this.store.updateStatus(graph.taskId, "failed");
    } else {
      status = "partial";
    }

    return {
      taskId: graph.taskId,
      status,
      completedSteps,
      failedSteps,
      goalPassed,
      goalReason,
    };
  }

  /**
   * Execute a single step.
   */
  private async executeStep(
    step: Step,
    graph: TaskGraph,
    state: Map<string, unknown>,
  ): Promise<StepResult> {
    const executor = this.agentExecutors.get(step.type);
    if (!executor) {
      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: "execution_error",
          message: `No executor registered for step type: ${step.type}`,
          retryable: false,
        },
      };
    }

    const context: ExecutionContext = {
      taskId: graph.taskId,
      workingDir: process.cwd(),
      state,
      securityArbiter: this.securityArbiter,
    };

    try {
      return await executor(step, context);
    } catch (error) {
      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: "execution_error",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    }
  }

  /**
   * Check if step dependencies are met.
   */
  private checkDependencies(step: Step, completedSteps: string[]): boolean {
    return step.dependsOn.every((dep) => completedSteps.includes(dep));
  }

  /**
   * Check security for a step.
   */
  private async checkSecurity(step: Step): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.securityArbiter) {
      return { allowed: true };
    }

    // Check file operations
    if (step.type === "file" && "action" in step) {
      const action = step.action as { op: string; path?: string; src?: string; dst?: string };
      if (action.path) {
        const result = this.securityArbiter.checkPath(action.path);
        if (!result.allowed) {
          return result;
        }
      }
      if (action.src) {
        const result = this.securityArbiter.checkPath(action.src);
        if (!result.allowed) {
          return result;
        }
      }
      if (action.dst) {
        const result = this.securityArbiter.checkPath(action.dst);
        if (!result.allowed) {
          return result;
        }
      }
    }

    // Check shell commands
    if (step.type === "shell" && "action" in step) {
      const action = step.action as { command: string };
      const result = this.securityArbiter.checkCommand(action.command);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  }
}
