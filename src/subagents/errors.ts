// src/subagents/errors.ts
/**
 * SubAgent Error Classification
 *
 * Provides error classification and handling utilities for SubAgent execution.
 */

import type { SubAgentError, SubAgentErrorType } from "./types.js";

/**
 * Determine if an error is retryable.
 *
 * @param errorType - The error type
 * @returns Whether the error is retryable
 */
export function isRetryable(errorType: SubAgentErrorType): boolean {
  const retryableTypes: SubAgentErrorType[] = [
    "timeout",
    "network_error",
    "rate_limited",
    "unknown",
  ];

  return retryableTypes.includes(errorType);
}

/**
 * SubAgentError class for throwing classified errors.
 */
export class SubAgentErrorClass extends Error implements SubAgentError {
  readonly type: SubAgentErrorType;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(
    type: SubAgentErrorType,
    message: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "SubAgentError";
    this.type = type;
    this.retryable = isRetryable(type);
    this.context = options?.context;
  }

  toJSON(): SubAgentError {
    return {
      type: this.type,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

/**
 * Classify an error into a SubAgentErrorType.
 *
 * @param error - The error to classify
 * @returns Classified error type
 */
export function classifyError(error: unknown): SubAgentErrorType {
  if (error instanceof SubAgentErrorClass) {
    return error.type;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors (check first before 'not found')
    if (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("network error")
    ) {
      return "network_error";
    }

    // Resource not found
    if (
      message.includes("not found") ||
      message.includes("enoent") ||
      message.includes("does not exist")
    ) {
      return "resource_not_found";
    }

    // Permission denied
    if (
      message.includes("permission") ||
      message.includes("eacces") ||
      message.includes("denied")
    ) {
      return "permission_denied";
    }

    // Timeout
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("etimedout")
    ) {
      return "timeout";
    }

    // Security blocked
    if (message.includes("security") || message.includes("blocked")) {
      return "security_blocked";
    }

    // Rate limited
    if (message.includes("rate limit") || message.includes("too many") || message.includes("429")) {
      return "rate_limited";
    }

    // Invalid input
    if (
      message.includes("invalid") ||
      message.includes("malformed") ||
      message.includes("bad request")
    ) {
      return "invalid_input";
    }
  }

  return "unknown";
}

/**
 * Get suggested retry delay for an error type.
 *
 * @param errorType - The error type
 * @param attempt - Current attempt number
 * @returns Suggested delay in milliseconds
 */
export function getRetryDelay(errorType: SubAgentErrorType, attempt: number): number {
  const baseDelays: Record<SubAgentErrorType, number> = {
    timeout: 2000,
    network_error: 1000,
    rate_limited: 5000,
    unknown: 1000,
    resource_not_found: 0,
    permission_denied: 0,
    security_blocked: 0,
    dependency_failed: 0,
    invalid_input: 0,
    execution_error: 1000,
  };

  const baseDelay = baseDelays[errorType] ?? 1000;

  // Return 0 for non-retryable errors
  if (baseDelay === 0) {
    return 0;
  }

  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 500;

  return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
}

/**
 * Create a SubAgentError from an unknown error.
 *
 * @param error - The original error
 * @param context - Additional context
 * @returns Structured SubAgentError
 */
export function createSubAgentError(
  error: unknown,
  context?: Record<string, unknown>,
): SubAgentError {
  if (error instanceof Error) {
    const type = classifyError(error);
    return {
      type,
      message: error.message,
      retryable: isRetryable(type),
      cause: error,
      context,
    };
  }

  return {
    type: "unknown",
    message: String(error),
    retryable: true,
    context,
  };
}

/**
 * Error messages for common error types.
 */
export const ErrorMessages: Record<SubAgentErrorType, string> = {
  resource_not_found: "The requested resource was not found",
  permission_denied: "Permission denied for this operation",
  timeout: "Operation timed out",
  security_blocked: "Operation blocked by security policy",
  dependency_failed: "A required dependency failed",
  invalid_input: "Invalid input provided",
  execution_error: "An error occurred during execution",
  network_error: "A network error occurred",
  rate_limited: "Rate limit exceeded, please retry later",
  unknown: "An unknown error occurred",
};
