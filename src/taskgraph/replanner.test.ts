// src/taskgraph/replanner.test.ts
import { describe, it, expect, vi } from "vitest";
import { PartialReplanner } from "./replanner.js";
import type { TaskGraph, Step } from "./types.js";

describe("PartialReplanner", () => {
  describe("analyzeFailure", () => {
    it("classifies resource not found failure", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "File not found: /tmp/test.txt");

      expect(analysis.type).toBe("resource_not_found");
      expect(analysis.recoverable).toBe(true);
    });

    it("classifies permission denied failure", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "Permission denied: /etc/passwd");

      expect(analysis.type).toBe("permission_denied");
      expect(analysis.recoverable).toBe(true);
    });

    it("classifies timeout failure", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "Operation timed out after 30s");

      expect(analysis.type).toBe("timeout");
      expect(analysis.recoverable).toBe(true);
    });

    it("classifies security blocked failure", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(
        graph,
        "step-1",
        "Security blocked: path not allowed",
      );

      expect(analysis.type).toBe("security_blocked");
      expect(analysis.recoverable).toBe(false);
      expect(analysis.recoveryApproach).toBe("abort");
    });

    it("returns non-recoverable when replan limit exceeded", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();
      graph.replanCount = 3; // At limit

      const analysis = replanner.analyzeFailure(graph, "step-1", "File not found");

      expect(analysis.recoverable).toBe(false);
    });

    it("suggests retry for transient failures", () => {
      const replanner = new PartialReplanner(vi.fn());

      expect(replanner.shouldAutoRetry("timeout", "Connection timeout")).toBe(true);
      expect(replanner.shouldAutoRetry("unexpected_error", "ECONNRESET")).toBe(true);
      expect(replanner.shouldAutoRetry("unexpected_error", "ETIMEDOUT")).toBe(true);
    });

    it("suggests no retry for permanent failures", () => {
      const replanner = new PartialReplanner(vi.fn());

      expect(replanner.shouldAutoRetry("permission_denied", "Access denied")).toBe(false);
      expect(replanner.shouldAutoRetry("security_blocked", "Path blocked")).toBe(false);
    });

    it("builds failure context for LLM", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "File not found: /tmp/test.txt");

      expect(analysis.context).toContain("Original Goal");
      expect(analysis.context).toContain("Failed Step");
      expect(analysis.context).toContain("resource_not_found");
      expect(analysis.context).toContain("File not found");
    });

    it("returns failure analysis for unknown step", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "nonexistent", "Error");

      expect(analysis.type).toBe("unexpected_error");
      expect(analysis.recoverable).toBe(false);
    });
  });

  describe("generateRecovery", () => {
    it("generates recovery TaskGraph using planner", async () => {
      const mockLlm = vi.fn().mockResolvedValue({
        goalAssertion: { type: "file_exists", path: "/tmp/recovered.txt", description: "Recovery" },
        steps: [
          {
            id: "recovery-1",
            type: "file",
            desc: "Create recovery file",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "write", path: "/tmp/recovered.txt", content: "recovered" },
          },
        ],
      });

      const replanner = new PartialReplanner(mockLlm);
      const graph = createTestTaskGraph();
      graph.steps = [createStep("step-1"), createStep("step-2")];

      const recovered = await replanner.generateRecovery(
        graph,
        ["step-1"],
        "step-2",
        "File not found",
      );

      expect(recovered.replanCount).toBe(1);
      expect(recovered.status).toBe("replanning");
      expect(recovered.steps.length).toBeGreaterThan(0);
    });

    it("returns failed status when replan limit exceeded", async () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();
      graph.replanCount = 3; // At limit

      const result = await replanner.generateRecovery(graph, [], "step-1", "Error");

      expect(result.status).toBe("failed");
    });
  });

  describe("recovery approaches", () => {
    it("suggests retry_same_step for timeout", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "Timeout");

      expect(analysis.recoveryApproach).toBe("retry_same_step");
    });

    it("suggests alternative_approach for resource not found", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "Not found");

      expect(analysis.recoveryApproach).toBe("alternative_approach");
    });

    it("suggests request_user_input for permission denied", () => {
      const replanner = new PartialReplanner(vi.fn());
      const graph = createTestTaskGraph();

      const analysis = replanner.analyzeFailure(graph, "step-1", "Permission denied");

      expect(analysis.recoveryApproach).toBe("request_user_input");
    });
  });
});

function createTestTaskGraph(): TaskGraph {
  return {
    taskId: "test-task",
    goal: "Test goal",
    goalAssertion: {
      type: "file_exists",
      path: "/tmp/test.txt",
      description: "Test file should exist",
    },
    steps: [createStep("step-1")],
    limits: {
      maxSteps: 50,
      maxTokens: 50000,
      maxReplans: 3,
    },
    status: "running",
    currentStepIndex: 0,
    replanCount: 0,
  };
}

function createStep(id: string): Step {
  return {
    id,
    type: "file",
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action: { op: "read", path: "/tmp/test.txt" },
  };
}
