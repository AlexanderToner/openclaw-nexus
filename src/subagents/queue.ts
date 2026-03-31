// src/subagents/queue.ts
/**
 * Execution Queue
 *
 * Manages serial execution of SubAgent steps.
 * Ensures steps are executed in order with proper error handling.
 */

import type { Step } from "../taskgraph/types.js";
import { CircuitBreaker, type CircuitBreakerConfig } from "./circuit-breaker.js";
import type { SubAgent, SubAgentContext, SubAgentResult } from "./types.js";

/**
 * Queued execution item.
 */
interface QueuedExecution {
  step: Step;
  agent: SubAgent;
  context: SubAgentContext;
  resolve: (result: SubAgentResult) => void;
  reject: (error: Error) => void;
}

/**
 * Execution queue configuration.
 */
export interface ExecutionQueueConfig {
  /** Maximum concurrent executions (default: 1 for serial) */
  concurrency?: number;

  /** Circuit breaker configuration */
  circuitBreaker?: Partial<CircuitBreakerConfig>;

  /** Enable logging */
  verbose?: boolean;
}

/**
 * ExecutionQueue manages step execution with queuing and fault tolerance.
 */
export class ExecutionQueue {
  private queue: QueuedExecution[] = [];
  private running = 0;
  private config: Required<Pick<ExecutionQueueConfig, "concurrency" | "verbose">> &
    Pick<ExecutionQueueConfig, "circuitBreaker">;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(config?: ExecutionQueueConfig) {
    this.config = {
      concurrency: config?.concurrency ?? 1,
      verbose: config?.verbose ?? false,
      circuitBreaker: config?.circuitBreaker,
    };
  }

  /**
   * Execute a step through an agent.
   *
   * @param step - The step to execute
   * @param agent - The agent to use
   * @param context - Execution context
   * @returns Execution result
   */
  async execute(step: Step, agent: SubAgent, context: SubAgentContext): Promise<SubAgentResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        step,
        agent,
        context,
        resolve,
        reject,
      });

      this.processQueue();
    });
  }

  /**
   * Execute immediately without queuing.
   *
   * @param step - The step to execute
   * @param agent - The agent to use
   * @param context - Execution context
   * @returns Execution result
   */
  async executeImmediate(
    step: Step,
    agent: SubAgent,
    context: SubAgentContext,
  ): Promise<SubAgentResult> {
    const circuitBreaker = this.getCircuitBreaker(agent.type);

    try {
      const result = await circuitBreaker.execute(() => agent.execute(step, context));
      return result;
    } catch (error) {
      if (error instanceof Error) {
        return {
          stepId: step.id,
          status: "failed",
          error: {
            type: "execution_error",
            message: error.message,
            retryable: true,
          },
        };
      }
      throw error;
    }
  }

  /**
   * Get queue length.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty.
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get number of running executions.
   */
  getRunningCount(): number {
    return this.running;
  }

  /**
   * Clear the queue.
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get circuit breaker for an agent type.
   */
  getCircuitBreaker(agentType: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(agentType);
    if (!breaker) {
      breaker = new CircuitBreaker(this.config.circuitBreaker);
      this.circuitBreakers.set(agentType, breaker);
    }
    return breaker;
  }

  /**
   * Process the execution queue.
   */
  private processQueue(): void {
    while (this.running < this.config.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        break;
      }

      this.running++;
      void this.executeItem(item).finally(() => {
        this.running--;
        this.processQueue();
      });
    }
  }

  /**
   * Execute a queued item.
   */
  private async executeItem(item: QueuedExecution): Promise<void> {
    const { step, agent, context, resolve, reject } = item;
    const circuitBreaker = this.getCircuitBreaker(agent.type);

    try {
      const result = await circuitBreaker.execute(() => agent.execute(step, context));
      resolve(result);
    } catch (error) {
      if (error instanceof Error) {
        resolve({
          stepId: step.id,
          status: "failed",
          error: {
            type: "execution_error",
            message: error.message,
            retryable: true,
          },
        });
      } else {
        reject(error as Error);
      }
    }
  }
}
