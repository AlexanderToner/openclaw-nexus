// src/subagents/circuit-breaker.ts
/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern for fault tolerance.
 * Prevents cascading failures by failing fast when a service is unhealthy.
 */

/**
 * Circuit breaker states.
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;

  /** Time in ms to wait before attempting to close circuit */
  resetTimeoutMs: number;

  /** Number of successes in half-open state to close circuit */
  successThreshold: number;

  /** Enable logging */
  verbose?: boolean;
}

/**
 * Default circuit breaker configuration.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
  successThreshold: 3,
  verbose: false,
};

/**
 * Circuit breaker statistics.
 */
export interface CircuitStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * CircuitBreaker implements the circuit breaker pattern.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failing fast, requests are rejected immediately
 * - HALF-OPEN: Testing if service recovered, limited requests pass through
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private openedAt: number | null = null;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * @param fn - The function to execute
   * @returns The function result
   * @throws CircuitOpenError if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if we should transition from open to half-open
    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        this.transitionToHalfOpen();
      } else {
        throw new CircuitOpenError("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if the circuit allows requests.
   */
  isAllowed(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      if (this.shouldAttemptReset()) {
        return true;
      }
      return false;
    }

    // Half-open: allow limited requests
    return true;
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics.
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Force open the circuit.
   */
  trip(): void {
    this.state = "open";
    this.openedAt = Date.now();
    this.log("Circuit tripped open");
  }

  /**
   * Force close the circuit.
   */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
    this.log("Circuit reset to closed");
  }

  /**
   * Handle successful execution.
   */
  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    this.failureCount = 0;

    if (this.state === "half-open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }

    this.log(`Success (state: ${this.state}, failures: ${this.failureCount})`);
  }

  /**
   * Handle failed execution.
   */
  private onFailure(): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === "half-open") {
      // Failure in half-open state -> back to open
      this.transitionToOpen();
    } else if (this.state === "closed") {
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }

    this.log(`Failure (state: ${this.state}, failures: ${this.failureCount})`);
  }

  /**
   * Check if we should attempt to reset from open state.
   */
  private shouldAttemptReset(): boolean {
    if (this.openedAt === null) {
      return false;
    }

    const elapsed = Date.now() - this.openedAt;
    return elapsed >= this.config.resetTimeoutMs;
  }

  /**
   * Transition to open state.
   */
  private transitionToOpen(): void {
    this.state = "open";
    this.openedAt = Date.now();
    this.successCount = 0;
    this.log("Transitioned to OPEN state");
  }

  /**
   * Transition to half-open state.
   */
  private transitionToHalfOpen(): void {
    this.state = "half-open";
    this.successCount = 0;
    this.log("Transitioned to HALF-OPEN state");
  }

  /**
   * Transition to closed state.
   */
  private transitionToClosed(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.openedAt = null;
    this.log("Transitioned to CLOSED state");
  }

  /**
   * Log if verbose mode is enabled.
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[CircuitBreaker] ${message}`);
    }
  }
}

/**
 * Error thrown when circuit is open.
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}
