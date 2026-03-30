// src/taskgraph/types.ts
/**
 * TaskGraph Types
 *
 * Core types for the TaskGraph execution engine.
 * TaskGraph replaces the traditional Agent loop with structured,
 * one-time planning and deterministic execution.
 */

/**
 * TaskLimits defines hard limits for task execution.
 * These prevent runaway tasks and ensure termination.
 */
export interface TaskLimits {
  /** Maximum number of steps allowed (default: 50) */
  maxSteps: number;

  /** Maximum total tokens allowed (default: 50000) */
  maxTokens: number;

  /** Maximum number of replans allowed (default: 3) */
  maxReplans: number;

  /** Timeout in seconds (undefined = OFF, useful for long tasks) */
  timeoutSeconds?: number;
}

/**
 * TaskGraph represents the complete execution plan for a task.
 * Generated once by the planner, then executed step by step.
 */
export interface TaskGraph {
  /** Unique task identifier */
  taskId: string;

  /** User's original goal description */
  goal: string;

  /** Assertion to verify goal completion */
  goalAssertion: Assertion;

  /** List of execution steps */
  steps: Step[];

  /** Hard limits for this task */
  limits: TaskLimits;

  /** Current task status */
  status: TaskStatus;

  /** Index of currently executing step */
  currentStepIndex: number;

  /** Number of times replanning has occurred */
  replanCount: number;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "replanning";

/**
 * Step represents a single atomic operation in the TaskGraph.
 */
export interface Step {
  /** Unique step identifier */
  id: string;

  /** Type of agent to execute this step */
  type: StepType;

  /** Human-readable description */
  desc: string;

  /** IDs of steps this step depends on */
  dependsOn: string[];

  /** Timeout for this step in milliseconds */
  timeoutMs: number;

  /** The action to perform */
  action: FileAction | ShellAction | GUIAction | BrowserAction;
}

export type StepType = "file" | "shell" | "gui" | "browser";

/**
 * Assertion types for goal verification.
 * These allow deterministic completion checking without LLM judgment.
 */
export interface Assertion {
  type: AssertionType;
  conditions?: Assertion[];
  path?: string;
  expected?: number | string;
  command?: string;
  description: string;
}

export type AssertionType =
  | "all_of"
  | "any_of"
  | "directory_not_empty"
  | "file_count_equals"
  | "file_exists"
  | "file_contains"
  | "custom";

// === Action Types ===

export interface FileAction {
  op: "read" | "write" | "list" | "move" | "copy" | "delete" | "mkdir";
  path?: string;
  src?: string;
  dst?: string;
  content?: string;
}

export interface ShellAction {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface GUIAction {
  action: "click" | "type" | "scroll" | "drag" | "wait" | "focus";
  target?: GUIElementSelector;
  payload?: string;
  timeoutMs?: number;
}

export interface GUIElementSelector {
  type: "text" | "role" | "id" | "xpath" | "coordinates";
  value: string;
  window?: string;
}

export interface BrowserAction {
  action: "navigate" | "click" | "type" | "extract" | "screenshot" | "wait";
  url?: string;
  selector?: string;
  payload?: string;
  timeoutMs?: number;
}