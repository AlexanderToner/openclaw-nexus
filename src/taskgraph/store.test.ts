import * as fs from "fs/promises";
import * as path from "path";
// src/taskgraph/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskGraphStore, generateTaskId } from "./store.js";
import type { TaskGraph } from "./types.js";

describe("TaskGraphStore", () => {
  const testDir = "/tmp/taskgraph-store-test";
  let store: TaskGraphStore;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    store = new TaskGraphStore(testDir);
    await store.initialize();
  });

  afterEach(async () => {
    store.clearCache();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("save/load", () => {
    it("saves and loads TaskGraph", async () => {
      const graph = createTestTaskGraph("task-001");
      await store.save(graph);

      const loaded = await store.load("task-001");
      expect(loaded).not.toBeNull();
      expect(loaded?.taskId).toBe("task-001");
      expect(loaded?.goal).toBe("Test goal");
      expect(loaded?.status).toBe("pending");
    });

    it("returns null for non-existent task", async () => {
      const loaded = await store.load("nonexistent");
      expect(loaded).toBeNull();
    });

    it("uses cache for repeated loads", async () => {
      const graph = createTestTaskGraph("task-002");
      await store.save(graph);

      // First load from disk
      await store.load("task-002");

      // Modify file on disk
      const filePath = path.join(testDir, "task-002.json");
      await fs.writeFile(filePath, JSON.stringify({ taskId: "modified" }));

      // Second load should use cache
      const loaded2 = await store.load("task-002");
      expect(loaded2?.taskId).toBe("task-002"); // cached value
    });

    it("clears cache correctly", async () => {
      const graph = createTestTaskGraph("task-003");
      await store.save(graph);

      store.clearCache();

      // Should load from disk after cache cleared
      const loaded = await store.load("task-003");
      expect(loaded).not.toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes TaskGraph", async () => {
      const graph = createTestTaskGraph("task-004");
      await store.save(graph);

      const deleted = await store.delete("task-004");
      expect(deleted).toBe(true);

      const loaded = await store.load("task-004");
      expect(loaded).toBeNull();
    });

    it("returns false for non-existent task", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("list", () => {
    it("lists all task IDs", async () => {
      await store.save(createTestTaskGraph("task-a"));
      await store.save(createTestTaskGraph("task-b"));
      await store.save(createTestTaskGraph("task-c"));

      const ids = await store.list();
      expect(ids.toSorted()).toEqual(["task-a", "task-b", "task-c"]);
    });

    it("returns empty array when no tasks", async () => {
      const ids = await store.list();
      expect(ids).toEqual([]);
    });
  });

  describe("listByStatus", () => {
    it("filters by status", async () => {
      const pendingGraph = createTestTaskGraph("task-pending", "pending");
      const runningGraph = createTestTaskGraph("task-running", "running");
      const completedGraph = createTestTaskGraph("task-completed", "completed");

      await store.save(pendingGraph);
      await store.save(runningGraph);
      await store.save(completedGraph);

      const pendingIds = await store.listByStatus("pending");
      expect(pendingIds).toEqual(["task-pending"]);

      const runningIds = await store.listByStatus("running");
      expect(runningIds).toEqual(["task-running"]);

      const completedIds = await store.listByStatus("completed");
      expect(completedIds).toEqual(["task-completed"]);
    });
  });

  describe("updateStatus", () => {
    it("updates status", async () => {
      const graph = createTestTaskGraph("task-005", "pending");
      await store.save(graph);

      const success = await store.updateStatus("task-005", "running");
      expect(success).toBe(true);

      const loaded = await store.load("task-005");
      expect(loaded?.status).toBe("running");
    });

    it("returns false for non-existent task", async () => {
      const success = await store.updateStatus("nonexistent", "running");
      expect(success).toBe(false);
    });
  });

  describe("updateStepIndex", () => {
    it("updates step index", async () => {
      const graph = createTestTaskGraph("task-006");
      await store.save(graph);

      const success = await store.updateStepIndex("task-006", 5);
      expect(success).toBe(true);

      const loaded = await store.load("task-006");
      expect(loaded?.currentStepIndex).toBe(5);
    });
  });

  describe("incrementReplanCount", () => {
    it("increments replan count", async () => {
      const graph = createTestTaskGraph("task-007");
      graph.replanCount = 0;
      await store.save(graph);

      const count1 = await store.incrementReplanCount("task-007");
      expect(count1).toBe(1);

      const count2 = await store.incrementReplanCount("task-007");
      expect(count2).toBe(2);

      const loaded = await store.load("task-007");
      expect(loaded?.replanCount).toBe(2);
    });

    it("returns -1 for non-existent task", async () => {
      const count = await store.incrementReplanCount("nonexistent");
      expect(count).toBe(-1);
    });
  });

  describe("checkpoints", () => {
    it("creates checkpoint", async () => {
      const graph = createTestTaskGraph("task-008");
      await store.save(graph);

      const success = await store.createCheckpoint("task-008", "before-step-1");
      expect(success).toBe(true);

      const checkpoints = await store.listCheckpoints("task-008");
      expect(checkpoints).toContain("before-step-1");
    });

    it("restores from checkpoint", async () => {
      const graph = createTestTaskGraph("task-009", "pending");
      await store.save(graph);

      await store.createCheckpoint("task-009", "initial");

      // Modify the graph
      await store.updateStatus("task-009", "running");
      await store.updateStepIndex("task-009", 3);

      // Restore from checkpoint
      const restored = await store.restoreCheckpoint("task-009", "initial");
      expect(restored).not.toBeNull();
      expect(restored?.status).toBe("pending");
      expect(restored?.currentStepIndex).toBe(0);
    });

    it("returns null for non-existent checkpoint", async () => {
      const restored = await store.restoreCheckpoint("task-009", "nonexistent");
      expect(restored).toBeNull();
    });
  });
});

describe("generateTaskId", () => {
  it("generates unique IDs", () => {
    const id1 = generateTaskId();
    const id2 = generateTaskId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^task-[a-z0-9]+-[a-z0-9]+$/);
    expect(id2).toMatch(/^task-[a-z0-9]+-[a-z0-9]+$/);
  });
});

function createTestTaskGraph(taskId: string, status: TaskGraph["status"] = "pending"): TaskGraph {
  return {
    taskId,
    goal: "Test goal",
    goalAssertion: {
      type: "file_exists",
      path: "/tmp/test.txt",
      description: "Test file should exist",
    },
    steps: [
      {
        id: "step-1",
        type: "file",
        desc: "Create test file",
        dependsOn: [],
        timeoutMs: 5000,
        action: { op: "write", path: "/tmp/test.txt", content: "test" },
      },
    ],
    limits: {
      maxSteps: 50,
      maxTokens: 50000,
      maxReplans: 3,
    },
    status,
    currentStepIndex: 0,
    replanCount: 0,
  };
}
