// src/taskgraph/planner.test.ts
import { describe, it, expect, vi } from "vitest";
import { TaskGraphPlanner } from "./planner.js";
import type { TaskGraph, Step } from "./types.js";

describe("TaskGraphPlanner", () => {
  describe("plan", () => {
    it("generates TaskGraph from user goal", async () => {
      const mockOutput = {
        goal: "Read the configuration file",
        goalAssertion: {
          type: "file_contains",
          path: "~/config.json",
          expected: "settings",
          description: "Config file should contain settings",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "Read config file",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read", path: "~/config.json" },
          },
        ],
      };

      const mockLlm = vi.fn().mockResolvedValue(mockOutput);
      const planner = new TaskGraphPlanner(mockLlm);

      const graph = await planner.plan("读取配置文件");

      expect(graph.goal).toBe("Read the configuration file");
      expect(graph.status).toBe("pending");
      expect(graph.currentStepIndex).toBe(0);
      expect(graph.replanCount).toBe(0);
      expect(graph.steps).toHaveLength(1);
      expect(graph.goalAssertion.type).toBe("file_contains");
      expect(graph.taskId).toMatch(/^task-/);
    });

    it("includes limits in generated graph", async () => {
      const mockOutput = {
        goal: "Test goal",
        goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
        steps: [],
      };

      const mockLlm = vi.fn().mockResolvedValue(mockOutput);
      const planner = new TaskGraphPlanner(mockLlm);

      const limits = { maxSteps: 10, maxTokens: 1000, maxReplans: 1 };
      const graph = await planner.plan("test", limits);

      expect(graph.limits.maxSteps).toBe(10);
      expect(graph.limits.maxReplans).toBe(1);
    });

    it("passes Viking context to LLM", async () => {
      const mockOutput = {
        goal: "Test",
        goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
        steps: [],
      };

      const mockLlm = vi.fn().mockResolvedValue(mockOutput);
      const planner = new TaskGraphPlanner(mockLlm);

      await planner.plan("test", undefined, {
        vikingContext: {
          intent: "file_ops",
          requiredFiles: ["~/Documents/report.md"],
          requiredTools: ["fs_read"],
        },
      });

      expect(mockLlm).toHaveBeenCalled();
      const prompt = mockLlm.mock.calls[0][0];
      expect(prompt).toContain("Viking Context");
      expect(prompt).toContain("file_ops");
      expect(prompt).toContain("~/Documents/report.md");
    });

    it("validates and fixes missing step IDs", async () => {
      const mockOutput = {
        goal: "Test",
        goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
        steps: [
          { type: "file", desc: "Step 1", dependsOn: [], timeoutMs: 5000, action: { op: "read" } },
          {
            id: "custom",
            type: "file",
            desc: "Step 2",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read" },
          },
        ],
      };

      const mockLlm = vi.fn().mockResolvedValue(mockOutput);
      const planner = new TaskGraphPlanner(mockLlm);

      const graph = await planner.plan("test");

      expect(graph.steps[0].id).toBe("step-1");
      expect(graph.steps[1].id).toBe("custom");
    });

    it("limits steps to maxSteps", async () => {
      const mockOutput = {
        goal: "Test",
        goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
        steps: Array.from({ length: 20 }, (_, i) => ({
          id: `step-${i}`,
          type: "file",
          desc: `Step ${i}`,
          dependsOn: [],
          timeoutMs: 5000,
          action: { op: "read" },
        })),
      };

      const mockLlm = vi.fn().mockResolvedValue(mockOutput);
      const planner = new TaskGraphPlanner(mockLlm);

      const limits = { maxSteps: 5, maxTokens: 50000, maxReplans: 3 };
      const graph = await planner.plan("test", limits);

      expect(graph.steps.length).toBe(5);
    });
  });

  describe("replan", () => {
    it("creates partial replan keeping completed steps", async () => {
      const existingGraph = createTestTaskGraph();
      existingGraph.steps = [
        createStep("step-1", "Read file"),
        createStep("step-2", "Process content"),
        createStep("step-3", "Write output"),
      ];

      const mockOutput = {
        goalAssertion: {
          type: "file_exists",
          path: "/tmp/output.txt",
          description: "Output exists",
        },
        steps: [
          {
            id: "recovery-1",
            type: "file",
            desc: "Retry write",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "write", path: "/tmp/output.txt" },
          },
        ],
      };

      const mockLlm = vi.fn().mockResolvedValue(mockOutput);
      const planner = new TaskGraphPlanner(mockLlm);

      const newGraph = await planner.replan(
        existingGraph,
        ["step-1", "step-2"],
        "step-3",
        "Write failed: permission denied",
      );

      // Should keep completed steps
      expect(newGraph.steps).toHaveLength(3);
      expect(newGraph.steps[0].id).toBe("step-1");
      expect(newGraph.steps[1].id).toBe("step-2");

      // Should add recovery steps
      expect(newGraph.steps[2].id).toBe("recovery-1");

      // Recovery step should depend on last completed
      expect(newGraph.steps[2].dependsOn).toContain("step-2");

      // Should increment replan count
      expect(newGraph.replanCount).toBe(1);
      expect(newGraph.status).toBe("replanning");
    });

    it("includes error context in replan prompt", async () => {
      const existingGraph = createTestTaskGraph();

      const mockLlm = vi.fn().mockResolvedValue({
        goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
        steps: [],
      });

      const planner = new TaskGraphPlanner(mockLlm);

      await planner.replan(existingGraph, [], "step-1", "File not found: /tmp/test.txt");

      const prompt = mockLlm.mock.calls[0][0];
      expect(prompt).toContain("Failed Step");
      expect(prompt).toContain("File not found");
    });

    it("adjusts currentStepIndex after replan", async () => {
      const existingGraph = createTestTaskGraph();
      existingGraph.steps = [
        createStep("step-1", "A"),
        createStep("step-2", "B"),
        createStep("step-3", "C"),
      ];

      const mockLlm = vi.fn().mockResolvedValue({
        goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
        steps: [createStep("recovery-1", "Retry")],
      });

      const planner = new TaskGraphPlanner(mockLlm);

      const newGraph = await planner.replan(existingGraph, ["step-1"], "step-2", "Error");

      expect(newGraph.currentStepIndex).toBe(1); // After step-1
    });
  });
});

function createTestTaskGraph(): TaskGraph {
  return {
    taskId: "task-test",
    goal: "Test goal",
    goalAssertion: { type: "file_exists", path: "/tmp/test.txt", description: "Test" },
    steps: [],
    limits: { maxSteps: 50, maxTokens: 50000, maxReplans: 3 },
    status: "running",
    currentStepIndex: 0,
    replanCount: 0,
  };
}

function createStep(id: string, desc: string): Step {
  return {
    id,
    type: "file",
    desc,
    dependsOn: [],
    timeoutMs: 5000,
    action: { op: "read", path: "/tmp/test.txt" },
  };
}
