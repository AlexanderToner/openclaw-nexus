// src/taskgraph/checkpoint.test.ts
import * as fs from "fs/promises";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CheckpointManager } from "./checkpoint.js";
import { TaskGraphStore } from "./store.js";
import type { TaskGraph, Step } from "./types.js";

describe("CheckpointManager", () => {
  const testDir = "/tmp/checkpoint-test";
  let store: TaskGraphStore;
  let manager: CheckpointManager;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    store = new TaskGraphStore(testDir);
    await store.initialize();
    manager = new CheckpointManager(store);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("createCheckpoint", () => {
    it("creates checkpoint for TaskGraph", async () => {
      const graph = createTestTaskGraph();
      await store.save(graph);

      const meta = await manager.createCheckpoint(graph, "test-checkpoint", "user_requested");

      expect(meta.name).toBe("test-checkpoint");
      expect(meta.taskId).toBe(graph.taskId);
      expect(meta.reason).toBe("user_requested");
      expect(meta.stepIndex).toBe(0);
    });

    it("saves checkpoint metadata", async () => {
      const graph = createTestTaskGraph();
      await store.save(graph);

      await manager.createCheckpoint(
        graph,
        "meta-test",
        "before_critical_step",
        "Before important step",
      );

      const checkpoints = await manager.listCheckpoints(graph.taskId);
      expect(checkpoints.length).toBe(1);
      expect(checkpoints[0].description).toBe("Before important step");
    });
  });

  describe("restoreCheckpoint", () => {
    it("restores TaskGraph from checkpoint", async () => {
      const graph = createTestTaskGraph();
      graph.currentStepIndex = 3;
      await store.save(graph);

      await manager.createCheckpoint(graph, "restore-test", "user_requested");

      // Modify the graph
      graph.currentStepIndex = 5;
      graph.status = "running";
      await store.save(graph);

      // Restore
      const restored = await manager.restoreCheckpoint(graph.taskId, "restore-test");

      expect(restored).not.toBeNull();
      expect(restored?.currentStepIndex).toBe(3);
      expect(restored?.status).toBe("pending");
    });

    it("returns null for non-existent checkpoint", async () => {
      const restored = await manager.restoreCheckpoint("nonexistent", "checkpoint");
      expect(restored).toBeNull();
    });
  });

  describe("listCheckpoints", () => {
    it("lists all checkpoints sorted by creation time", async () => {
      const graph = createTestTaskGraph();
      await store.save(graph);

      await manager.createCheckpoint(graph, "checkpoint-1", "user_requested");
      await new Promise((r) => setTimeout(r, 10)); // Ensure different timestamps
      await manager.createCheckpoint(graph, "checkpoint-2", "user_requested");
      await new Promise((r) => setTimeout(r, 10));
      await manager.createCheckpoint(graph, "checkpoint-3", "user_requested");

      const checkpoints = await manager.listCheckpoints(graph.taskId);

      expect(checkpoints.length).toBe(3);
      // Should be sorted newest first
      expect(checkpoints[0].name).toBe("checkpoint-3");
      expect(checkpoints[2].name).toBe("checkpoint-1");
    });

    it("returns empty array when no checkpoints", async () => {
      const checkpoints = await manager.listCheckpoints("nonexistent");
      expect(checkpoints).toEqual([]);
    });
  });

  describe("auto checkpoint", () => {
    it("creates auto checkpoint when interval elapsed", async () => {
      manager = new CheckpointManager(store, 100); // 100ms interval
      const graph = createTestTaskGraph();
      await store.save(graph);

      const checkpoint1 = await manager.maybeAutoCheckpoint(graph);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.reason).toBe("auto_scheduled");

      // Immediately try again - should not create
      const checkpoint2 = await manager.maybeAutoCheckpoint(graph);
      expect(checkpoint2).toBeNull();

      // Wait for interval to pass
      await new Promise((r) => setTimeout(r, 150));
      const checkpoint3 = await manager.maybeAutoCheckpoint(graph);
      expect(checkpoint3).not.toBeNull();
    });

    it("does not create auto checkpoint when interval is 0", async () => {
      manager = new CheckpointManager(store, 0);
      const graph = createTestTaskGraph();
      await store.save(graph);

      const checkpoint = await manager.maybeAutoCheckpoint(graph);
      expect(checkpoint).toBeNull();
    });
  });

  describe("checkpointBeforeStep", () => {
    it("creates checkpoint before critical step", async () => {
      const graph = createTestTaskGraph();
      graph.steps = [createStep("critical-1"), createStep("critical-2")];
      await store.save(graph);

      const meta = await manager.checkpointBeforeStep(graph, graph.steps[0]);

      expect(meta.reason).toBe("before_critical_step");
      expect(meta.name).toContain("before-critical-1");
      expect(meta.description).toContain("critical-1");
    });
  });

  describe("findLatestCheckpoint", () => {
    it("finds most recent checkpoint", async () => {
      const graph = createTestTaskGraph();
      await store.save(graph);

      await manager.createCheckpoint(graph, "old", "user_requested");
      await new Promise((r) => setTimeout(r, 10));
      await manager.createCheckpoint(graph, "new", "user_requested");

      const latest = await manager.findLatestCheckpoint(graph.taskId);

      expect(latest).not.toBeNull();
      expect(latest?.name).toBe("new");
    });

    it("returns null when no checkpoints exist", async () => {
      const latest = await manager.findLatestCheckpoint("nonexistent");
      expect(latest).toBeNull();
    });
  });

  describe("getCheckpointStats", () => {
    it("returns checkpoint statistics", async () => {
      const graph = createTestTaskGraph();
      await store.save(graph);

      await manager.createCheckpoint(graph, "stat-1", "user_requested");
      await new Promise((r) => setTimeout(r, 10));
      await manager.createCheckpoint(graph, "stat-2", "auto_scheduled");

      const stats = await manager.getCheckpointStats(graph.taskId);

      expect(stats.count).toBe(2);
      expect(stats.oldestCheckpoint?.name).toBe("stat-1");
      expect(stats.newestCheckpoint?.name).toBe("stat-2");
    });

    it("returns zero count for no checkpoints", async () => {
      const stats = await manager.getCheckpointStats("nonexistent");

      expect(stats.count).toBe(0);
      expect(stats.oldestCheckpoint).toBeUndefined();
      expect(stats.newestCheckpoint).toBeUndefined();
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
      description: "Test file exists",
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
