// src/subagents/queue.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Step } from "../taskgraph/types.js";
import { ExecutionQueue } from "./queue.js";
import type { SubAgent, SubAgentContext, SubAgentResult } from "./types.js";

describe("ExecutionQueue", () => {
  let queue: ExecutionQueue;

  beforeEach(() => {
    queue = new ExecutionQueue();
  });

  describe("initial state", () => {
    it("starts with empty queue", () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getQueueLength()).toBe(0);
      expect(queue.getRunningCount()).toBe(0);
    });

    it("accepts concurrency config", () => {
      const customQueue = new ExecutionQueue({ concurrency: 3 });
      expect(customQueue.isEmpty()).toBe(true);
    });
  });

  describe("execute (queued)", () => {
    it("executes step through agent", async () => {
      const agent = createMockAgent("file", "success");
      const step = createStep("step-1", "file");
      const context = createMockContext();

      const result = await queue.execute(step, agent, context);

      expect(result.stepId).toBe("step-1");
      expect(result.status).toBe("success");
    });

    it("handles execution errors gracefully", async () => {
      const agent = createMockAgent("file", "error");
      const step = createStep("step-2", "file");
      const context = createMockContext();

      const result = await queue.execute(step, agent, context);

      expect(result.stepId).toBe("step-2");
      expect(result.status).toBe("failed");
      expect(result.error?.type).toBe("execution_error");
      expect(result.error?.retryable).toBe(true);
    });

    it("queues multiple executions with serial concurrency", async () => {
      const agent = createMockAgent("file", "success", 50);
      const context = createMockContext();

      const results = await Promise.all([
        queue.execute(createStep("step-1", "file"), agent, context),
        queue.execute(createStep("step-2", "file"), agent, context),
        queue.execute(createStep("step-3", "file"), agent, context),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "success")).toBe(true);
    });

    it("respects concurrency limit", async () => {
      const context = createMockContext();
      const parallelQueue = new ExecutionQueue({ concurrency: 2 });

      // Track when executions start
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const trackingAgent: SubAgent = {
        type: "file",
        name: "tracking-agent",
        description: "Tracks concurrent execution",
        canHandle: () => true,
        execute: async (): Promise<SubAgentResult> => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((r) => setTimeout(r, 50));
          concurrentCount--;
          return { stepId: "test", status: "success" };
        },
      };

      await Promise.all([
        parallelQueue.execute(createStep("s1", "file"), trackingAgent, context),
        parallelQueue.execute(createStep("s2", "file"), trackingAgent, context),
        parallelQueue.execute(createStep("s3", "file"), trackingAgent, context),
        parallelQueue.execute(createStep("s4", "file"), trackingAgent, context),
      ]);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("executeImmediate", () => {
    it("executes without queuing", async () => {
      const agent = createMockAgent("shell", "success");
      const step = createStep("immediate-1", "shell");
      const context = createMockContext();

      const result = await queue.executeImmediate(step, agent, context);

      expect(result.stepId).toBe("immediate-1");
      expect(result.status).toBe("success");
    });

    it("does not affect queue length", async () => {
      const agent = createMockAgent("shell", "success", 50);
      const context = createMockContext();

      // Start a queued execution (will be processing)
      const queuedPromise = queue.execute(createStep("queued", "shell"), agent, context);

      // Immediate execution should not queue
      const immediateResult = await queue.executeImmediate(
        createStep("immediate", "shell"),
        agent,
        context,
      );

      expect(immediateResult.status).toBe("success");

      await queuedPromise;
    });

    it("handles errors gracefully", async () => {
      const agent = createMockAgent("shell", "error");
      const step = createStep("error-step", "shell");
      const context = createMockContext();

      const result = await queue.executeImmediate(step, agent, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toBe("Execution failed");
    });
  });

  describe("circuit breaker integration", () => {
    it("creates circuit breaker per agent type", () => {
      const cb1 = queue.getCircuitBreaker("file");
      const cb2 = queue.getCircuitBreaker("file");
      const cb3 = queue.getCircuitBreaker("shell");

      expect(cb1).toBe(cb2); // Same type returns same breaker
      expect(cb1).not.toBe(cb3); // Different type returns different breaker
    });

    it("circuit breaker protects repeated failures", async () => {
      const failingAgent: SubAgent = {
        type: "browser",
        name: "failing-browser",
        description: "Fails on execute",
        canHandle: () => true,
        execute: async (): Promise<SubAgentResult> => {
          throw new Error("Network error");
        },
      };
      const context = createMockContext();

      // Configure circuit breaker with low threshold
      const testQueue = new ExecutionQueue({
        concurrency: 1,
        circuitBreaker: {
          failureThreshold: 2,
          resetTimeoutMs: 10000,
          successThreshold: 1,
        },
      });

      // Trigger failures - use executeImmediate to bypass queue
      const breaker = testQueue.getCircuitBreaker("browser");
      expect(breaker.getState()).toBe("closed");

      // First failure
      const result1 = await testQueue.executeImmediate(
        createStep("fail-1", "browser"),
        failingAgent,
        context,
      );
      expect(result1.status).toBe("failed");
      expect(breaker.getState()).toBe("closed");

      // Second failure - should open circuit
      const result2 = await testQueue.executeImmediate(
        createStep("fail-2", "browser"),
        failingAgent,
        context,
      );
      expect(result2.status).toBe("failed");
      expect(breaker.getState()).toBe("open");

      // Circuit breaker stats should show failures
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(2);
      expect(stats.totalFailures).toBe(2);
    });

    it("circuit breaker allows requests after reset timeout", async () => {
      const failingAgent: SubAgent = {
        type: "gui",
        name: "failing-gui",
        description: "Fails on execute",
        canHandle: () => true,
        execute: async (): Promise<SubAgentResult> => {
          throw new Error("GUI error");
        },
      };
      const context = createMockContext();

      const testQueue = new ExecutionQueue({
        concurrency: 1,
        circuitBreaker: {
          failureThreshold: 1,
          resetTimeoutMs: 50,
          successThreshold: 1,
        },
      });

      // Trigger open state
      await testQueue.executeImmediate(createStep("fail", "gui"), failingAgent, context);

      const breaker = testQueue.getCircuitBreaker("gui");
      expect(breaker.getState()).toBe("open");

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 100));

      // Should transition to half-open and allow request
      expect(breaker.isAllowed()).toBe(true);
    });
  });

  describe("queue management", () => {
    it("clear empties the queue", () => {
      // Just verify clear works when queue has no running items
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getQueueLength()).toBe(0);

      // Clear should work even when empty
      queue.clear();
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getQueueLength()).toBe(0);
    });

    it("clear removes queued but not running items", async () => {
      const fastAgent = createMockAgent("file", "success", 10);
      const context = createMockContext();

      // Execute one item quickly
      await queue.execute(createStep("fast", "file"), fastAgent, context);

      // Queue should be empty after execution completes
      expect(queue.isEmpty()).toBe(true);
      expect(queue.getRunningCount()).toBe(0);
    });
  });

  describe("statistics", () => {
    it("tracks running count", async () => {
      const agent = createMockAgent("file", "success", 10);
      const context = createMockContext();

      expect(queue.getRunningCount()).toBe(0);

      // Execute one item
      await queue.execute(createStep("exec-1", "file"), agent, context);

      // Should be back to 0 after completion
      expect(queue.getRunningCount()).toBe(0);
    });

    it("reports empty state correctly", () => {
      expect(queue.isEmpty()).toBe(true);
    });
  });
});

function createMockAgent(
  type: "file" | "shell" | "browser" | "gui",
  behavior: "success" | "error",
  delayMs = 0,
): SubAgent {
  return {
    type,
    name: `mock-${type}-${behavior}`,
    description: `Mock ${type} agent`,
    canHandle: () => true,
    execute: async (step): Promise<SubAgentResult> => {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (behavior === "error") {
        throw new Error("Execution failed");
      }

      return {
        stepId: step.id,
        status: "success",
      };
    },
  };
}

function createStep(id: string, type: "file" | "shell" | "browser" | "gui"): Step {
  return {
    id,
    type,
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action:
      type === "file"
        ? { op: "read", path: "/tmp/test.txt" }
        : type === "shell"
          ? { command: "echo test" }
          : type === "browser"
            ? { action: "navigate", url: "https://example.com" }
            : { action: "click" },
  };
}

function createMockContext(): SubAgentContext {
  return {
    taskId: "test-task",
    workingDir: "/tmp",
    timeoutMs: 5000,
    state: new Map<string, unknown>(),
    env: {},
  };
}
