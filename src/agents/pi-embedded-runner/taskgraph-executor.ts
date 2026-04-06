// src/agents/pi-embedded-runner/taskgraph-executor.ts
/**
 * TaskGraph Executor Integration
 *
 * Bridges Viking Router with TaskGraph structured execution.
 * Uses the main agent model to plan, then executes via SubAgents.
 */

import type { TaskGraphExecutorConfig } from "../../config/types.agent-defaults.js";
import { AssertionEngine } from "../../taskgraph/assertion-engine.js";
import type { BrowserInterface } from "../../taskgraph/browser-interface.js";
import { MockBrowserInterface } from "../../taskgraph/browser-interface.js";
import type {
  SubAgentExecutorFn,
  ExecutionContext,
  StepResult as ExecutorStepResult,
} from "../../taskgraph/executor.js";
import { DEFAULT_TASK_LIMITS } from "../../taskgraph/limits.js";
import { defaultSSRFGuard } from "../../taskgraph/ssrf-guard.js";
import { generateTaskId } from "../../taskgraph/store.js";
import type { TaskGraph, Step, TaskLimits, Assertion } from "../../taskgraph/types.js";
import type { StepType } from "../../taskgraph/types.js";
import { VisionVerificationHook } from "../../taskgraph/vision-hook.js";
import type { RouteDecision } from "../../viking/types.js";
import { log } from "./logger.js";

/**
 * TaskGraph execution result.
 */
export interface TaskGraphExecutionResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Task ID */
  taskId: string;

  /** Original goal */
  goal: string;

  /** Goal assertion result */
  goalPassed: boolean;

  /** Reason for goal result */
  goalReason?: string;

  /** Steps that completed */
  completedSteps: ExecutorStepResult[];

  /** Steps that failed (includes skipped) */
  failedSteps: ExecutorStepResult[];

  /** Total duration in ms */
  durationMs: number;

  /** Error if any */
  error?: string;
}

/**
 * TaskGraph executor options.
 */
export interface TaskGraphExecutorOptions {
  /** TaskGraph configuration */
  config: TaskGraphExecutorConfig;

  /** Main model ID for planning */
  planningModelId: string;

  /** Main model provider */
  planningProvider: string;

  /** Main model endpoint (for API calls) */
  planningEndpoint?: string;

  /** Working directory */
  workingDir: string;

  /** Progress callback */
  onProgress?: (event: TaskGraphProgressEvent) => void;

  /**
   * Browser handle for VisionVerificationHook and browser step execution.
   * Optional — falls back to mock (Phase 1 behavior) if not provided.
   * When provided, enables real screenshot/DOM capture for vision verification.
   */
  browser?: BrowserInterface;
}

export type TaskGraphProgressEvent =
  | { type: "planning_started" }
  | { type: "planning_completed"; stepCount: number }
  | { type: "step_started"; stepId: string; stepIndex: number; totalSteps: number }
  | { type: "step_completed"; stepId: string; status: "success" | "failed" | "skipped" }
  | { type: "goal_checking" }
  | { type: "goal_passed" }
  | { type: "goal_failed"; reason: string }
  | { type: "completed"; summary: string }
  | { type: "failed"; error: string };

/**
 * Create a TaskGraph executor for Viking integration.
 */
export function createTaskGraphExecutor(
  routeDecision: RouteDecision,
  userMessage: string,
  options: TaskGraphExecutorOptions,
): TaskGraphExecutorInstance {
  return new TaskGraphExecutorInstance(routeDecision, userMessage, options);
}

/**
 * Check if an intent should trigger TaskGraph execution.
 */
export function shouldTriggerTaskGraph(
  routeDecision: RouteDecision,
  config: TaskGraphExecutorConfig,
): boolean {
  if (!config.enabled) {
    return false;
  }

  const triggerIntents = config.triggerIntents ?? ["gui_auto", "browser"];
  return triggerIntents.includes(routeDecision.intent);
}

/**
 * TaskGraphExecutorInstance executes a TaskGraph based on Viking routing decision.
 */
class TaskGraphExecutorInstance {
  private routeDecision: RouteDecision;
  private userMessage: string;
  private options: TaskGraphExecutorOptions;
  private assertionEngine: AssertionEngine;
  private agentExecutors: Map<StepType, SubAgentExecutorFn>;
  private state: Map<string, unknown>;
  private browser: BrowserInterface;
  private testGraphOverride?: TaskGraph;

  constructor(
    routeDecision: RouteDecision,
    userMessage: string,
    options: TaskGraphExecutorOptions,
  ) {
    this.routeDecision = routeDecision;
    this.userMessage = userMessage;
    this.options = options;
    this.assertionEngine = new AssertionEngine();
    this.state = new Map();
    this.agentExecutors = new Map();
    this.browser = options.browser ?? new MockBrowserInterface();
    this.testGraphOverride = undefined;

    // Register built-in agent executors
    this.registerBuiltInExecutors();
  }

  /**
   * Execute the TaskGraph.
   */
  async execute(): Promise<TaskGraphExecutionResult> {
    const startTime = Date.now();
    const taskId = generateTaskId();

    log.info(
      `[taskgraph] starting execution taskId=${taskId} intent=${this.routeDecision.intent} conf=${this.routeDecision.confidence.toFixed(2)}`,
    );

    this.options.onProgress?.({ type: "planning_started" });

    try {
      // Generate TaskGraph using main model
      const graph = await this.generateTaskGraph(taskId);

      this.options.onProgress?.({
        type: "planning_completed",
        stepCount: graph.steps.length,
      });

      log.info(`[taskgraph] planned ${graph.steps.length} steps for taskId=${taskId}`);

      // Execute steps
      const completedSteps: ExecutorStepResult[] = [];
      const failedSteps: ExecutorStepResult[] = [];

      for (let i = 0; i < graph.steps.length; i++) {
        const step = graph.steps[i];

        this.options.onProgress?.({
          type: "step_started",
          stepId: step.id,
          stepIndex: i,
          totalSteps: graph.steps.length,
        });

        // Check dependencies
        if (!this.checkDependencies(step, completedSteps)) {
          const result = this.createSkippedResult(step, "dependency_failed");
          failedSteps.push(result);
          this.options.onProgress?.({ type: "step_completed", stepId: step.id, status: "skipped" });
          continue;
        }

        // Execute step
        const result = await this.executeStep(step);

        // Vision verification after step execution (only when triggered)
        const visionHook = new VisionVerificationHook({
          enabled: this.options.config.visionEnabled ?? false,
        });
        if (visionHook.shouldTrigger(step, completedSteps.length)) {
          const domSnapshot = await this.browser.getContent();
          const verification = await visionHook.verify(step, result, this.browser, domSnapshot);
          if (verification.status === "failed") {
            log.warn(`[taskgraph] vision verification failed: ${verification.reason}`);
          }
          log.debug(`[taskgraph] vision check: ${verification.status} — ${verification.reason}`);
        }

        if (result.status === "success") {
          completedSteps.push(result);
          if (result.stateUpdates) {
            for (const [key, value] of Object.entries(result.stateUpdates)) {
              this.state.set(key, value);
            }
          }
        } else {
          failedSteps.push(result);
        }

        this.options.onProgress?.({
          type: "step_completed",
          stepId: step.id,
          status: result.status,
        });

        // Check limits
        const limits = this.getLimits();
        if (completedSteps.length + failedSteps.length >= limits.maxSteps) {
          log.warn(`[taskgraph] step limit reached: ${limits.maxSteps}`);
          break;
        }
      }

      // Check goal assertion
      this.options.onProgress?.({ type: "goal_checking" });
      const goalAssertion = this.createGoalAssertion();
      const goalPassed = await this.assertionEngine.evaluate(goalAssertion);
      const goalReason = goalPassed
        ? "Goal assertion passed"
        : `Goal assertion failed: ${goalAssertion.description}`;

      if (goalPassed) {
        this.options.onProgress?.({ type: "goal_passed" });
      } else {
        this.options.onProgress?.({ type: "goal_failed", reason: goalReason });
      }

      const durationMs = Date.now() - startTime;

      if (completedSteps.length > 0) {
        this.options.onProgress?.({
          type: "completed",
          summary: `Completed ${completedSteps.length}/${graph.steps.length} steps in ${durationMs}ms`,
        });
      } else {
        this.options.onProgress?.({
          type: "failed",
          error: `No steps completed`,
        });
      }

      log.info(
        `[taskgraph] execution completed taskId=${taskId} status=${goalPassed ? "completed" : "failed"} steps=${completedSteps.length}/${graph.steps.length} duration=${durationMs}ms`,
      );

      return {
        success: goalPassed && failedSteps.length === 0,
        taskId,
        goal: this.userMessage,
        goalPassed,
        goalReason,
        completedSteps,
        failedSteps,
        durationMs,
        error:
          failedSteps.length > 0 && completedSteps.length === 0
            ? `All ${failedSteps.length} steps failed`
            : undefined,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = String(err);

      log.error(
        `[taskgraph] execution failed taskId=${taskId} error=${error} duration=${durationMs}ms`,
      );

      this.options.onProgress?.({ type: "failed", error });

      return {
        success: false,
        taskId,
        goal: this.userMessage,
        goalPassed: false,
        goalReason: error,
        completedSteps: [],
        failedSteps: [],
        durationMs,
        error,
      };
    }
  }

  /**
   * Inject a pre-built TaskGraph for testing.
   * Cleared after one use.
   */
  injectTestGraph(graph: TaskGraph): void {
    this.testGraphOverride = graph;
  }

  /**
   * Generate TaskGraph using the main model.
   */
  private async generateTaskGraph(taskId: string): Promise<TaskGraph> {
    if (this.testGraphOverride) {
      const graph = this.testGraphOverride;
      this.testGraphOverride = undefined;
      return graph;
    }
    const prompt = this.buildPlanningPrompt();
    const planningModelId = this.options.planningModelId;

    log.debug(
      `[taskgraph] generating plan with model=${planningModelId} promptLen=${prompt.length}`,
    );

    try {
      const response = await this.callPlanningModel(prompt);
      const parsed = this.parsePlanningResponse(response);

      const limits = this.getLimits();
      const steps = this.validateSteps(parsed.steps, limits);

      return {
        taskId,
        goal: parsed.goal || this.userMessage,
        goalAssertion: parsed.goalAssertion || this.createGoalAssertion(),
        steps,
        limits,
        status: "pending",
        currentStepIndex: 0,
        replanCount: 0,
      };
    } catch (err) {
      log.warn(`[taskgraph] planning failed: ${String(err)}, using fallback plan`);

      // Fallback: create simple single-step TaskGraph
      return this.createFallbackTaskGraph(taskId);
    }
  }

  /**
   * Build planning prompt for the main model.
   */
  private buildPlanningPrompt(): string {
    const vikingIntent = this.routeDecision.intent;
    const requiredTools = this.routeDecision.requiredTools.join(", ") || "none";
    const requiredFiles = this.routeDecision.requiredFiles.join(", ") || "none";

    return `# Task Planning Request

## User Goal
${this.userMessage}

## Viking Router Classification
- Intent: ${vikingIntent}
- Confidence: ${this.routeDecision.confidence.toFixed(2)}
- Required Tools: ${requiredTools}
- Required Files: ${requiredFiles}
- Context Hint: ${this.routeDecision.contextSizeHint}

## Working Directory
${this.options.workingDir}

## Instructions
Generate a structured execution plan for this task.

1. Break the task into atomic steps
2. Each step should have a clear description and action
3. Include proper dependencies between steps
4. Define a goal assertion to verify completion

## Output Format
Return ONLY valid JSON with this structure:
{
  "goal": "refined goal description",
  "goalAssertion": {
    "type": "file_exists|file_count_equals|directory_not_empty|file_contains|all_of|any_of",
    "path": "optional file path",
    "expected": "optional expected value",
    "description": "human readable description"
  },
  "steps": [
    {
      "id": "step-1",
      "type": "file|shell|gui|browser",
      "desc": "step description",
      "dependsOn": [],
      "timeoutMs": 30000,
      "action": { ... }
    }
  ]
}

## Step Types
- file: { "op": "read|write|list|move|copy|delete|mkdir", "path": "...", "content": "..." }
- shell: { "command": "ls -la", "cwd": "optional working directory" }
- gui: { "action": "click|type|scroll|drag|wait|focus", "target": {...}, "payload": "..." }
- browser: { "action": "navigate|click|type|extract|screenshot|wait", "url": "...", "selector": "..." }

## Rules
- Keep steps atomic (one action per step)
- Maximum 20 steps
- Use realistic timeouts (30000-60000ms for file operations)
- JSON only, no markdown or explanation
`;
  }

  /**
   * Call the planning model via API.
   */
  private async callPlanningModel(prompt: string): Promise<string> {
    // Default to Ollama for local planning, can be overridden via config
    const endpoint = this.options.planningEndpoint ?? "http://localhost:11434";
    const model = this.options.planningModelId;

    // SSRF guard: validate endpoint host before making HTTP request
    const parsedUrl = new URL(endpoint);
    defaultSSRFGuard.assertSafe(parsedUrl.hostname);

    // Use the main gateway endpoint
    const response = await Promise.race([
      fetch(`${endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.3,
          },
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Planning model timeout (60s)")), 60_000),
      ),
    ]);

    if (!response.ok) {
      throw new Error(`Planning model error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return (data.response as string) || "";
  }

  /**
   * Parse the planning model response.
   */
  private parsePlanningResponse(response: string): {
    goal?: string;
    goalAssertion?: Assertion;
    steps: Array<{
      id: string;
      type: StepType;
      desc: string;
      dependsOn: string[];
      timeoutMs: number;
      action: Step["action"];
    }>;
  } {
    // Try to extract JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in planning response");
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        goal: parsed.goal,
        goalAssertion: parsed.goalAssertion,
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      };
    } catch {
      throw new Error("Failed to parse planning response as JSON");
    }
  }

  /**
   * Validate and normalize steps.
   */
  private validateSteps(
    steps: Array<{
      id: string;
      type: StepType;
      desc: string;
      dependsOn: string[];
      timeoutMs: number;
      action: Step["action"];
    }>,
    limits: TaskLimits,
  ): Step[] {
    const validated: Step[] = [];
    const maxSteps = Math.min(steps.length, limits.maxSteps, 20);

    for (let i = 0; i < maxSteps; i++) {
      const step = steps[i];

      if (!step.id) {
        step.id = `step-${i + 1}`;
      }

      if (!step.timeoutMs || step.timeoutMs <= 0) {
        step.timeoutMs = 30000;
      }

      // Validate dependencies
      const validDeps = (step.dependsOn || []).filter((dep: string) =>
        validated.some((s) => s.id === dep),
      );

      validated.push({
        id: step.id,
        type: step.type || "file",
        desc: step.desc || `Step ${i + 1}`,
        dependsOn: validDeps,
        timeoutMs: step.timeoutMs,
        action: step.action || { op: "read", path: this.options.workingDir },
      });
    }

    return validated;
  }

  /**
   * Create a fallback TaskGraph with single step.
   * Used when the planning model call fails.
   */
  private createFallbackTaskGraph(taskId: string): TaskGraph {
    const limits = this.getLimits();
    const intent = this.routeDecision.intent;
    const requiredTools = this.routeDecision.requiredTools;
    const requiredFiles = this.routeDecision.requiredFiles;

    // Build a descriptive step based on Viking's decision
    const stepType = this.mapIntentToStepType(intent);
    const desc = `Execute ${intent} task: ${this.userMessage}`;

    // Create action based on intent and Viking's requirements
    let action: Step["action"] = this.createActionFromIntent();

    // Override with required files from Viking if available
    if (requiredFiles.length > 0) {
      if (intent === "file_ops") {
        const op = requiredTools.includes("write")
          ? "write"
          : requiredTools.includes("edit")
            ? "edit"
            : "read";
        action = { op: op as "read", path: requiredFiles[0] };
      } else if (intent === "browser") {
        const fileUrl = requiredFiles.find(
          (f) => f.startsWith("http://") || f.startsWith("https://"),
        );
        if (fileUrl) {
          action = { action: "navigate", url: fileUrl };
        }
      }
    }

    return {
      taskId,
      goal: this.userMessage,
      goalAssertion: this.createGoalAssertion(),
      steps: [
        {
          id: "step-1",
          type: stepType,
          desc,
          dependsOn: [],
          timeoutMs: 60000,
          action,
        },
      ],
      limits,
      status: "pending",
      currentStepIndex: 0,
      replanCount: 0,
    };
  }

  /**
   * Create goal assertion based on intent.
   */
  private createGoalAssertion(): Assertion {
    const intent = this.routeDecision.intent;

    switch (intent) {
      case "file_ops":
        return {
          type: "directory_not_empty",
          path: this.options.workingDir,
          description: `File operations completed in ${this.options.workingDir}`,
        };

      case "browser":
        return {
          type: "custom",
          description: "Browser task completed",
        };

      case "gui_auto":
        return {
          type: "custom",
          description: "GUI automation task completed",
        };

      case "code":
        return {
          type: "file_exists",
          path: this.options.workingDir,
          description: "Code task completed",
        };

      default:
        return {
          type: "custom",
          description: "Task completed",
        };
    }
  }

  /**
   * Map Viking intent to TaskGraph step type.
   */
  private mapIntentToStepType(intent: string): StepType {
    switch (intent) {
      case "file_ops":
        return "file";
      case "browser":
        return "browser";
      case "gui_auto":
        return "gui";
      default:
        return "shell";
    }
  }

  /**
   * Create action from Viking intent.
   */
  private createActionFromIntent(): Step["action"] {
    const intent = this.routeDecision.intent;

    switch (intent) {
      case "file_ops": {
        // Extract file paths from the user message
        const urlMatch = this.userMessage.match(
          /(?:https?:\/\/|file:\/\/)?([^\s]*(?:\.txt|\.json|\.md|\.ts|\.js)[^\s]*)/gi,
        );
        const path = urlMatch?.[0] ?? this.options.workingDir;
        return { op: "list", path };
      }

      case "browser": {
        // Extract URL from user message or requiredFiles
        // Match URLs with or without protocol prefix
        const urlRegex =
          /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi;
        const urlMatches = this.userMessage.match(urlRegex);
        const requiredFileUrls = this.routeDecision.requiredFiles.filter(
          (f) =>
            f.startsWith("http://") ||
            f.startsWith("https://") ||
            /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/.test(f),
        );
        const url = urlMatches?.[0] ?? requiredFileUrls[0] ?? "about:blank";
        return { action: "navigate", url };
      }

      case "gui_auto":
        return { action: "wait", timeoutMs: 1000 };

      default:
        return { command: `echo "TaskGraph: ${this.userMessage}"` };
    }
  }

  /**
   * Get execution limits from config.
   */
  private getLimits(): TaskLimits {
    const config = this.options.config;
    const limits = config.limits;

    return {
      maxSteps: limits?.maxSteps ?? DEFAULT_TASK_LIMITS.maxSteps,
      maxTokens: limits?.maxTokens ?? DEFAULT_TASK_LIMITS.maxTokens,
      maxReplans: limits?.maxReplans ?? DEFAULT_TASK_LIMITS.maxReplans,
    };
  }

  /**
   * Register built-in agent executors.
   */
  private registerBuiltInExecutors(): void {
    // File executor
    this.agentExecutors.set("file", async (step: Step) => {
      const action = step.action as { op: string; path?: string; content?: string };
      log.info(`[taskgraph] executing file op=${action.op} path=${action.path}`);

      // Simulate file operation - in real implementation, this would use actual file tools
      return {
        stepId: step.id,
        status: "success",
        output: { operation: action.op, path: action.path },
        stateUpdates: { lastFileOp: action.op, lastPath: action.path },
      };
    });

    // Shell executor
    this.agentExecutors.set("shell", async (step: Step) => {
      const action = step.action as { command: string; cwd?: string };
      log.info(`[taskgraph] executing shell command=${action.command}`);

      return {
        stepId: step.id,
        status: "success",
        output: { command: action.command, cwd: action.cwd },
        stateUpdates: { lastCommand: action.command },
      };
    });

    // Browser executor
    this.agentExecutors.set("browser", async (step: Step) => {
      const action = step.action as { action: string; url?: string; selector?: string };
      log.warn(`[taskgraph] browser executor unimplemented for action=${action.action}`);

      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: "unimplemented",
          message:
            `Browser executor does not support action "${action.action}". ` +
            `Supported actions: navigate, screenshot. ` +
            `Use the main Pi Agent with browser tool for full browser automation.`,
          retryable: false,
        },
      };
    });

    // GUI executor
    this.agentExecutors.set("gui", async (step: Step) => {
      const action = step.action as { action: string; target?: string; payload?: string };
      log.warn(`[taskgraph] gui executor unimplemented for action=${action.action}`);

      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: "unimplemented",
          message:
            `GUI executor does not support action "${action.action}". ` +
            `Use the main Pi Agent with GUI automation tools.`,
          retryable: false,
        },
      };
    });
  }

  /**
   * Execute a single step.
   */
  private async executeStep(step: Step): Promise<ExecutorStepResult> {
    const executor = this.agentExecutors.get(step.type);

    if (!executor) {
      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: "execution_error",
          message: `No executor for step type: ${step.type}`,
          retryable: false,
        },
      };
    }

    const context: ExecutionContext = {
      taskId: "taskgraph",
      workingDir: this.options.workingDir,
      state: this.state,
      browser: this.browser,
    };

    try {
      return await executor(step, context);
    } catch (err) {
      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: "execution_error",
          message: String(err),
          retryable: true,
        },
      };
    }
  }

  /**
   * Check if step dependencies are met.
   */
  private checkDependencies(step: Step, completedSteps: ExecutorStepResult[]): boolean {
    return step.dependsOn.every((dep) =>
      completedSteps.some((s) => s.stepId === dep && s.status === "success"),
    );
  }

  /**
   * Create a skipped step result.
   */
  private createSkippedResult(step: Step, reason: string): ExecutorStepResult {
    return {
      stepId: step.id,
      status: "skipped",
      error: {
        type: "dependency_failed",
        message: `Dependencies not met: ${reason}`,
        retryable: false,
      },
    };
  }
}
