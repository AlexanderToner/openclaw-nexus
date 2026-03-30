// src/taskgraph/limits.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskLimitsChecker, DEFAULT_TASK_LIMITS, LimitExceededError } from "./limits";
import type { TaskGraph } from "./types";

describe("TaskLimitsChecker", () => {
  const createTestGraph = (overrides?: Partial<TaskGraph>): TaskGraph => ({
    taskId: "test-1",
    goal: "Test goal",
    goalAssertion: { type: "custom", description: "done" },
    steps: [],
    limits: DEFAULT_TASK_LIMITS,
    status: "running",
    currentStepIndex: 0,
    replanCount: 0,
    ...overrides,
  });

  it("has correct default limits", () => {
    expect(DEFAULT_TASK_LIMITS.maxSteps).toBe(50);
    expect(DEFAULT_TASK_LIMITS.maxTokens).toBe(50000);
    expect(DEFAULT_TASK_LIMITS.maxReplans).toBe(3);
    expect(DEFAULT_TASK_LIMITS.timeoutSeconds).toBeUndefined();
  });

  describe("isStepsExceeded", () => {
    it("returns false when under limit", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ currentStepIndex: 10 });

      expect(checker.isStepsExceeded(graph)).toBe(false);
    });

    it("returns true when at limit", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ currentStepIndex: 50 });

      expect(checker.isStepsExceeded(graph)).toBe(true);
    });

    it("returns true when over limit", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ currentStepIndex: 100 });

      expect(checker.isStepsExceeded(graph)).toBe(true);
    });
  });

  describe("isReplansExceeded", () => {
    it("returns false when under limit", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ replanCount: 2 });

      expect(checker.isReplansExceeded(graph)).toBe(false);
    });

    it("returns true when at limit", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ replanCount: 3 });

      expect(checker.isReplansExceeded(graph)).toBe(true);
    });
  });

  describe("isTokensExceeded", () => {
    it("returns false when under limit", () => {
      const checker = new TaskLimitsChecker();
      checker.addTokens(10000);

      expect(checker.isTokensExceeded()).toBe(false);
    });

    it("returns true when over limit", () => {
      const checker = new TaskLimitsChecker();
      checker.addTokens(60000);

      expect(checker.isTokensExceeded()).toBe(true);
    });
  });

  describe("isTimeoutExceeded", () => {
    it("returns false when timeout not set", async () => {
      const checker = new TaskLimitsChecker({ ...DEFAULT_TASK_LIMITS, timeoutSeconds: undefined });

      // Wait a bit
      await new Promise((r) => setTimeout(r, 100));

      expect(checker.isTimeoutExceeded()).toBe(false);
    });

    it("returns true when timeout exceeded", async () => {
      const checker = new TaskLimitsChecker({
        ...DEFAULT_TASK_LIMITS,
        timeoutSeconds: 0.1, // 100ms
      });

      // Wait longer than timeout
      await new Promise((r) => setTimeout(r, 200));

      expect(checker.isTimeoutExceeded()).toBe(true);
    });
  });

  describe("checkAll", () => {
    it("returns null when all limits OK", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ currentStepIndex: 10, replanCount: 0 });

      expect(checker.checkAll(graph)).toBeNull();
    });

    it("returns steps error when steps exceeded", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ currentStepIndex: 60 });

      const error = checker.checkAll(graph);
      expect(error).toBeInstanceOf(LimitExceededError);
      expect(error?.limitType).toBe("steps");
    });

    it("returns replans error when replans exceeded", () => {
      const checker = new TaskLimitsChecker();
      const graph = createTestGraph({ replanCount: 5 });

      const error = checker.checkAll(graph);
      expect(error).toBeInstanceOf(LimitExceededError);
      expect(error?.limitType).toBe("replans");
    });
  });

  describe("LimitExceededError", () => {
    it("has correct properties", () => {
      const error = new LimitExceededError("steps", 60, 50);

      expect(error.limitType).toBe("steps");
      expect(error.current).toBe(60);
      expect(error.max).toBe(50);
      expect(error.message).toContain("steps");
      expect(error.message).toContain("60");
      expect(error.message).toContain("50");
    });
  });
});