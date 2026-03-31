// src/subagents/types.ts
/**
 * SubAgent Types
 *
 * Type definitions for the SubAgent execution layer.
 * SubAgents are specialized agents that execute specific types of steps.
 */

import type { Step } from "../taskgraph/types.js";

/**
 * SubAgent type identifier.
 * Each type corresponds to a specific domain of operations.
 */
export type SubAgentType = "file" | "shell" | "browser" | "gui";

/**
 * Execution context passed to SubAgents.
 * Provides access to shared state, security, and configuration.
 */
export interface SubAgentContext {
  /** Unique task ID this execution belongs to */
  taskId: string;

  /** Working directory for file operations */
  workingDir: string;

  /** Maximum time allowed for this step */
  timeoutMs: number;

  /** Shared state across SubAgents */
  state: Map<string, unknown>;

  /** Security arbiter for permission checks */
  securityArbiter?: SecurityArbiterInterface;

  /** Environment variables */
  env?: Record<string, string>;

  /** Logger interface */
  logger?: LoggerInterface;
}

/**
 * Security arbiter interface for SubAgents.
 */
export interface SecurityArbiterInterface {
  checkPath(path: string): SecurityCheckResult;
  checkCommand(command: string): SecurityCheckResult;
  checkDomain(domain: string): SecurityCheckResult;
  checkPort(port: number): SecurityCheckResult;
}

/**
 * Security check result.
 */
export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  rule?: string;
}

/**
 * Logger interface for SubAgents.
 */
export interface LoggerInterface {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Result from SubAgent execution.
 */
export interface SubAgentResult {
  /** Step ID that was executed */
  stepId: string;

  /** Execution status */
  status: SubAgentStatus;

  /** Output data from execution */
  output?: unknown;

  /** Error details if failed */
  error?: SubAgentError;

  /** State updates to merge into shared state */
  stateUpdates?: Record<string, unknown>;

  /** Execution metadata */
  metadata?: {
    durationMs: number;
    tokensUsed?: number;
    retries?: number;
  };
}

/**
 * SubAgent execution status.
 */
export type SubAgentStatus = "success" | "failed" | "skipped" | "timeout" | "cancelled";

/**
 * SubAgent error details.
 */
export interface SubAgentError {
  /** Error classification */
  type: SubAgentErrorType;

  /** Human-readable error message */
  message: string;

  /** Whether the error is retryable */
  retryable: boolean;

  /** Original error if available */
  cause?: unknown;

  /** Additional error context */
  context?: Record<string, unknown>;
}

/**
 * Classification of SubAgent errors.
 */
export type SubAgentErrorType =
  | "resource_not_found"
  | "permission_denied"
  | "timeout"
  | "security_blocked"
  | "dependency_failed"
  | "invalid_input"
  | "execution_error"
  | "network_error"
  | "rate_limited"
  | "unknown";

/**
 * SubAgent interface.
 * All SubAgents must implement this interface.
 */
export interface SubAgent {
  /** Agent type identifier */
  readonly type: SubAgentType;

  /** Human-readable name */
  readonly name: string;

  /** Agent description */
  readonly description: string;

  /**
   * Execute a step.
   *
   * @param step - The step to execute
   * @param context - Execution context
   * @returns Execution result
   */
  execute(step: Step, context: SubAgentContext): Promise<SubAgentResult>;

  /**
   * Validate a step before execution.
   *
   * @param step - The step to validate
   * @returns Validation result
   */
  validate?(step: Step): ValidationResult;

  /**
   * Check if this agent can execute a step.
   *
   * @param step - The step to check
   * @returns Whether this agent can handle the step
   */
  canHandle(step: Step): boolean;
}

/**
 * Step validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * SubAgent capability descriptor.
 * Describes what operations an agent can perform.
 */
export interface SubAgentCapability {
  /** Operations this agent supports */
  operations: string[];

  /** Required permissions */
  requiredPermissions?: string[];

  /** Resource limits */
  limits?: {
    maxFileSize?: number;
    maxCommandLength?: number;
    maxTimeoutMs?: number;
  };
}

/**
 * SubAgent configuration.
 */
export interface SubAgentConfig {
  /** Enable detailed logging */
  verbose?: boolean;

  /** Default timeout for operations */
  defaultTimeoutMs?: number;

  /** Maximum retries for retryable errors */
  maxRetries?: number;

  /** Delay between retries */
  retryDelayMs?: number;

  /** Custom environment variables */
  env?: Record<string, string>;
}

/**
 * Default SubAgent configuration.
 */
export const DEFAULT_SUBAGENT_CONFIG: SubAgentConfig = {
  verbose: false,
  defaultTimeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
};
