// test/taskgraph/taskgraph-e2e.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CheckpointManager } from "src/taskgraph/checkpoint.js";
import { TaskGraphStore } from "src/taskgraph/store.js";
import type { TaskGraph } from "src/taskgraph/types.js";
import { afterEach, describe, expect, it } from "vitest";

describe("TaskGraph e2e: checkpoint and resume", () => {
  // Per-test temp directories, cleaned up after each test
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  /**
   * Creates a temporary directory for use in a test.
   */
  async function makeTmpDir(): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "openclaw-tg-e2e-"));
    tmpDirs.push(dir);
    return dir;
  }

  /**
   * Builds a minimal TaskGraph for testing.
   */
  function makeGraph(overrides: Partial<TaskGraph> = {}): TaskGraph {
    return {
      taskId: "test-task",
      goal: "Echo test",
      goalAssertion: { type: "file_exists", path: "/tmp", description: "tmp exists" },
      steps: [
        {
          id: "s1",
          type: "shell",
          desc: "Step 1",
          dependsOn: [],
          timeoutMs: 5000,
          action: { command: "echo step1" },
        },
        {
          id: "s2",
          type: "shell",
          desc: "Step 2",
          dependsOn: ["s1"],
          timeoutMs: 5000,
          action: { command: "echo step2" },
        },
      ],
      limits: { maxSteps: 10, maxTokens: 50000, maxReplans: 1 },
      status: "running",
      currentStepIndex: 1,
      replanCount: 0,
      ...overrides,
    };
  }

  it("saves checkpoint after first step and restores it", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const graph = makeGraph({ taskId: "test-e2e-save", currentStepIndex: 1 });

    // Persist graph so checkpoint restore can load it
    await store.save(graph);

    const manager = new CheckpointManager(store);

    const meta = await manager.createCheckpoint(graph, "after-step-1", "auto_scheduled");
    expect(meta.taskId).toBe("test-e2e-save");
    expect(meta.stepIndex).toBe(1);
    expect(meta.name).toBe("after-step-1");
    expect(meta.reason).toBe("auto_scheduled");

    const restored = await manager.restoreCheckpoint("test-e2e-save", "after-step-1");
    expect(restored).not.toBeNull();
    expect(restored!.currentStepIndex).toBe(1);
    expect(restored!.status).toBe("pending");
  });

  it("lists checkpoints for a task", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const graph = makeGraph({ taskId: "test-e2e-list" });
    await store.save(graph);

    const manager = new CheckpointManager(store);

    await manager.createCheckpoint(graph, "first", "user_requested");
    // Ensure timestamps differ so createdAt ordering is deterministic
    await new Promise((r) => setTimeout(r, 10));
    await manager.createCheckpoint(graph, "second", "user_requested");

    const list = await manager.listCheckpoints("test-e2e-list");
    expect(list).toHaveLength(2);
    // Newest first
    expect(list[0].name).toBe("second");
    expect(list[1].name).toBe("first");
  });

  it("deletes checkpoint metadata", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const graph = makeGraph({ taskId: "test-e2e-delete" });
    await store.save(graph);

    const manager = new CheckpointManager(store);

    await manager.createCheckpoint(graph, "to-delete", "user_requested");

    let list = await manager.listCheckpoints("test-e2e-delete");
    expect(list).toHaveLength(1);

    await manager.deleteCheckpoint("test-e2e-delete", "to-delete");
    list = await manager.listCheckpoints("test-e2e-delete");
    expect(list).toHaveLength(0);
  });

  it("finds the latest checkpoint for a task", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const graph = makeGraph({ taskId: "test-e2e-latest" });
    await store.save(graph);

    const manager = new CheckpointManager(store);

    await manager.createCheckpoint(graph, "first", "user_requested");
    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 10));
    await manager.createCheckpoint(graph, "second", "user_requested");

    const latest = await manager.findLatestCheckpoint("test-e2e-latest");
    expect(latest).not.toBeNull();
    expect(latest!.name).toBe("second");
  });

  it("returns null when restoring a non-existent checkpoint", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const manager = new CheckpointManager(store);

    const restored = await manager.restoreCheckpoint("does-not-exist", "also-no");
    expect(restored).toBeNull();
  });

  it("returns checkpoint statistics for a task", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const graph = makeGraph({ taskId: "test-e2e-stats" });
    await store.save(graph);

    const manager = new CheckpointManager(store);

    await manager.createCheckpoint(graph, "a", "user_requested");
    // Ensure timestamps differ so createdAt ordering is deterministic
    await new Promise((r) => setTimeout(r, 10));
    await manager.createCheckpoint(graph, "b", "user_requested");

    const stats = await manager.getCheckpointStats("test-e2e-stats");
    expect(stats.count).toBe(2);
    expect(stats.oldestCheckpoint?.name).toBe("a");
    expect(stats.newestCheckpoint?.name).toBe("b");
  });

  it("auto checkpoint returns null when interval is zero", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const manager = new CheckpointManager(store, 0); // autoCheckpointInterval = 0
    const graph = makeGraph({ taskId: "test-e2e-auto" });
    await store.save(graph);

    const result = await manager.maybeAutoCheckpoint(graph);
    expect(result).toBeNull();
  });

  it("auto checkpoint fires when interval has elapsed", async () => {
    const storeDir = await makeTmpDir();
    const store = new TaskGraphStore(storeDir);
    await store.initialize();

    const manager = new CheckpointManager(store, 1); // fires every 1ms
    const graph = makeGraph({ taskId: "test-e2e-auto-fire" });
    await store.save(graph);

    const result = await manager.maybeAutoCheckpoint(graph);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("auto_scheduled");
    expect(result!.taskId).toBe("test-e2e-auto-fire");
  });
});
