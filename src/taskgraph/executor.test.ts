// src/taskgraph/executor.test.ts
import * as fs from "fs/promises";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SecurityArbiter } from "../security/arbiter.js";
import {
  TaskGraphExecutor,
  type SubAgentExecutorFn,
  type ExecutionContext,
  type StepResult,
} from "./executor.js";
import { TaskGraphStore } from "./store.js";
import type { TaskGraph, Step, StepType } from "./types.js";

describe("TaskGraphExecutor", () => {
  const testDir = "/tmp/taskgraph-executor-test";
  let store: TaskGraphStore;
  let executor: TaskGraphExecutor;
  let mockAgentExecutors: Map<StepType, SubAgentExecutorFn>;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    store = new TaskGraphStore(testDir);
    await store.initialize();

    mockAgentExecutors = new Map();
    mockAgentExecutors.set(
      "file",
      async (step: Step, _ctx: ExecutionContext): Promise<StepResult> => {
        return { stepId: step.id, status: "success", output: { content: "test" } };
      },
    );
    mockAgentExecutors.set(
      "shell",
      async (step: Step, _ctx: ExecutionContext): Promise<StepResult> => {
        return { stepId: step.id, status: "success", output: { stdout: "done" } };
      },
    );

    executor = new TaskGraphExecutor(store, mockAgentExecutors);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("execute", () => {
    it("executes all steps sequentially", async () => {
      const graph = createTestTaskGraph();
      graph.steps = [
        createStep("step-1", "file"),
        createStep("step-2", "file"),
        createStep("step-3", "file"),
      ];
      // Create marker file for goal assertion
      await fs.writeFile(path.join(testDir, "success-marker.txt"), "done");
      graph.goalAssertion = {
        type: "file_exists",
        path: path.join(testDir, "success-marker.txt"),
        description: "Marker exists",
      };

      await store.save(graph);

      const result = await executor.execute(graph);

      expect(result.status).toBe("completed");
      expect(result.completedSteps).toEqual(["step-1", "step-2", "step-3"]);
      expect(result.failedSteps).toEqual([]);
    });

    it("updates currentStepIndex during execution", async () => {
      const graph = createTestTaskGraph();
      graph.steps = [createStep("step-1", "file"), createStep("step-2", "file")];

      await store.save(graph);

      await executor.execute(graph);

      const saved = await store.load(graph.taskId);
      expect(saved?.currentStepIndex).toBe(2);
    });

    it("handles step failure with stopOnFailure", async () => {
      mockAgentExecutors.set("file", async (step: Step): Promise<StepResult> => {
        if (step.id === "step-2") {
          return {
            stepId: step.id,
            status: "failed",
            error: { type: "execution_error", message: "Failed", retryable: false },
          };
        }
        return { stepId: step.id, status: "success" };
      });

      executor = new TaskGraphExecutor(store, mockAgentExecutors);

      const graph = createTestTaskGraph();
      graph.steps = [
        createStep("step-1", "file"),
        createStep("step-2", "file"),
        createStep("step-3", "file"),
      ];

      await store.save(graph);

      const result = await executor.execute(graph, { stopOnFailure: true });

      expect(result.status).toBe("failed");
      expect(result.completedSteps).toEqual(["step-1"]);
      expect(result.failedSteps).toEqual(["step-2"]);
    });

    it("continues on failure with stopOnFailure=false", async () => {
      mockAgentExecutors.set("file", async (step: Step): Promise<StepResult> => {
        if (step.id === "step-2") {
          return {
            stepId: step.id,
            status: "failed",
            error: { type: "execution_error", message: "Failed", retryable: false },
          };
        }
        return { stepId: step.id, status: "success" };
      });

      executor = new TaskGraphExecutor(store, mockAgentExecutors);

      const graph = createTestTaskGraph();
      graph.steps = [
        createStep("step-1", "file"),
        createStep("step-2", "file"),
        createStep("step-3", "file"),
      ];

      await store.save(graph);

      const result = await executor.execute(graph, { stopOnFailure: false });

      expect(result.completedSteps).toEqual(["step-1", "step-3"]);
      expect(result.failedSteps).toEqual(["step-2"]);
    });

    it("respects step dependencies", async () => {
      const graph = createTestTaskGraph();
      graph.steps = [
        createStep("step-1", "file"),
        { ...createStep("step-2", "file"), dependsOn: ["step-1"] },
        { ...createStep("step-3", "file"), dependsOn: ["nonexistent"] }, // Will fail dependency check
      ];

      await store.save(graph);

      const result = await executor.execute(graph);

      // Step 3 should fail dependency check
      expect(result.completedSteps).toEqual(["step-1", "step-2"]);
      expect(result.failedSteps).toEqual(["step-3"]);
    });

    it("checks goal assertion after execution", async () => {
      const graph = createTestTaskGraph();
      graph.steps = [createStep("step-1", "file")];
      graph.goalAssertion = {
        type: "file_exists",
        path: path.join(testDir, "success-marker.txt"),
        description: "Marker file should exist",
      };

      // Create the marker file before execution
      await fs.writeFile(path.join(testDir, "success-marker.txt"), "done");

      await store.save(graph);

      const result = await executor.execute(graph);

      expect(result.goalPassed).toBe(true);
      expect(result.status).toBe("completed");
    });

    it("reports goal failure when assertion fails", async () => {
      const graph = createTestTaskGraph();
      graph.steps = [createStep("step-1", "file")];
      graph.goalAssertion = {
        type: "file_exists",
        path: "/nonexistent/file.txt",
        description: "File should exist",
      };

      await store.save(graph);

      const result = await executor.execute(graph);

      expect(result.goalPassed).toBe(false);
      expect(result.goalReason).toContain("failed");
    });
  });

  describe("progress events", () => {
    it("emits progress events", async () => {
      const events: unknown[] = [];
      const onProgress = (event: unknown) => events.push(event);

      const graph = createTestTaskGraph();
      graph.steps = [createStep("step-1", "file"), createStep("step-2", "file")];

      await store.save(graph);

      await executor.execute(graph, { onProgress });

      expect(events.some((e) => (e as { type: string }).type === "step_started")).toBe(true);
      expect(events.some((e) => (e as { type: string }).type === "step_completed")).toBe(true);
      expect(events.some((e) => (e as { type: string }).type === "goal_checking")).toBe(true);
    });
  });

  describe("security integration", () => {
    it("blocks insecure file operations", async () => {
      const mockArbiter = {
        checkPath: vi.fn().mockReturnValue({ allowed: false, reason: "Path blocked" }),
      };

      executor = new TaskGraphExecutor(
        store,
        mockAgentExecutors,
        mockArbiter as unknown as SecurityArbiter,
      );

      const graph = createTestTaskGraph();
      graph.steps = [
        {
          id: "step-1",
          type: "file",
          desc: "Read blocked path",
          dependsOn: [],
          timeoutMs: 5000,
          action: { op: "read", path: "/etc/passwd" },
        },
      ];

      await store.save(graph);

      const result = await executor.execute(graph);

      expect(result.status).toBe("failed");
      expect(result.goalReason).toContain("Security blocked");
    });

    it("blocks insecure shell commands", async () => {
      const mockArbiter = {
        checkPath: vi.fn().mockReturnValue({ allowed: true }),
        checkCommand: vi.fn().mockReturnValue({ allowed: false, reason: "Command blocked" }),
      };

      executor = new TaskGraphExecutor(
        store,
        mockAgentExecutors,
        mockArbiter as unknown as SecurityArbiter,
      );

      const graph = createTestTaskGraph();
      graph.steps = [
        {
          id: "step-1",
          type: "shell",
          desc: "Run blocked command",
          dependsOn: [],
          timeoutMs: 5000,
          action: { command: "rm -rf /" },
        },
      ];

      await store.save(graph);

      const result = await executor.execute(graph);

      expect(result.status).toBe("failed");
      expect(result.goalReason).toContain("Security blocked");
    });

    it("skips security checks when skipSecurity=true", async () => {
      const mockArbiter = {
        checkPath: vi.fn().mockReturnValue({ allowed: false }),
        checkCommand: vi.fn().mockReturnValue({ allowed: true }),
      };

      executor = new TaskGraphExecutor(
        store,
        mockAgentExecutors,
        mockArbiter as unknown as SecurityArbiter,
      );

      const graph = createTestTaskGraph();
      // Create marker file for goal assertion
      await fs.writeFile(path.join(testDir, "success-marker.txt"), "done");
      graph.goalAssertion = {
        type: "file_exists",
        path: path.join(testDir, "success-marker.txt"),
        description: "Marker exists",
      };
      graph.steps = [
        {
          id: "step-1",
          type: "file",
          desc: "Read file",
          dependsOn: [],
          timeoutMs: 5000,
          action: { op: "read", path: "/etc/passwd" },
        },
      ];

      await store.save(graph);

      const result = await executor.execute(graph, { skipSecurity: true });

      expect(result.status).toBe("completed");
      expect(mockArbiter.checkPath).not.toHaveBeenCalled();
    });
  });

  describe("state propagation", () => {
    it("propagates state updates between steps", async () => {
      const stateUpdates: unknown[] = [];

      mockAgentExecutors.set(
        "file",
        async (step: Step, ctx: ExecutionContext): Promise<StepResult> => {
          if (step.id === "step-1") {
            return {
              stepId: step.id,
              status: "success",
              stateUpdates: { fileContent: "hello world" },
            };
          }
          // Step 2 can access state from step 1
          stateUpdates.push(ctx.state.get("fileContent"));
          return { stepId: step.id, status: "success" };
        },
      );

      executor = new TaskGraphExecutor(store, mockAgentExecutors);

      const graph = createTestTaskGraph();
      graph.steps = [createStep("step-1", "file"), createStep("step-2", "file")];

      await store.save(graph);

      await executor.execute(graph);

      expect(stateUpdates).toEqual(["hello world"]);
    });
  });
});

function createTestTaskGraph(): TaskGraph {
  return {
    taskId: `test-${Date.now()}`,
    goal: "Test goal",
    goalAssertion: {
      type: "file_exists",
      path: "/tmp/test.txt",
      description: "Test file should exist",
    },
    steps: [],
    limits: {
      maxSteps: 50,
      maxTokens: 50000,
      maxReplans: 3,
    },
    status: "pending",
    currentStepIndex: 0,
    replanCount: 0,
  };
}

function createStep(id: string, type: "file" | "shell" | "gui" | "browser"): Step {
  return {
    id,
    type,
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action: type === "file" ? { op: "read", path: "/tmp/test.txt" } : { command: "echo test" },
  };
}
