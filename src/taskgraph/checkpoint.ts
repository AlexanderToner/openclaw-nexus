// src/taskgraph/checkpoint.ts
/**
 * Checkpoint Manager
 *
 * Manages TaskGraph checkpoints for recovery and state persistence.
 * Enables resumption of interrupted tasks and rollback on failure.
 */

import { expandHomePrefix } from "../infra/home-dir.js";
import { getTaskGraphConfig } from "./config.js";
import { TaskGraphStore } from "./store.js";
import type { TaskGraph, Step } from "./types.js";

/**
 * Checkpoint metadata.
 */
export interface CheckpointMeta {
  /** Checkpoint name */
  name: string;

  /** Task ID */
  taskId: string;

  /** Creation timestamp */
  createdAt: number;

  /** Step index at checkpoint time */
  stepIndex: number;

  /** Number of completed steps */
  completedSteps: number;

  /** Checkpoint reason */
  reason: CheckpointReason;

  /** Optional description */
  description?: string;
}

export type CheckpointReason =
  | "before_critical_step"
  | "after_phase_complete"
  | "user_requested"
  | "auto_scheduled"
  | "before_retry";

/**
 * CheckpointManager handles checkpoint creation, restoration, and lifecycle.
 */
export class CheckpointManager {
  private store: TaskGraphStore;
  private autoCheckpointInterval: number;
  private lastAutoCheckpoint: number = 0;

  constructor(store: TaskGraphStore, autoCheckpointInterval = 0) {
    this.store = store;
    this.autoCheckpointInterval = autoCheckpointInterval;
  }

  /**
   * Create a checkpoint for a TaskGraph.
   *
   * @param graph - The TaskGraph to checkpoint
   * @param name - Checkpoint name
   * @param reason - Reason for checkpoint
   * @param description - Optional description
   * @returns Checkpoint metadata
   */
  async createCheckpoint(
    graph: TaskGraph,
    name: string,
    reason: CheckpointReason,
    description?: string,
  ): Promise<CheckpointMeta> {
    await this.store.createCheckpoint(graph.taskId, name);

    const meta: CheckpointMeta = {
      name,
      taskId: graph.taskId,
      createdAt: Date.now(),
      stepIndex: graph.currentStepIndex,
      completedSteps: graph.steps.slice(0, graph.currentStepIndex).length,
      reason,
      description,
    };

    // Save metadata alongside checkpoint
    await this.saveCheckpointMeta(meta);

    return meta;
  }

  /**
   * Restore a TaskGraph from a checkpoint.
   *
   * @param taskId - Task ID
   * @param name - Checkpoint name
   * @returns Restored TaskGraph or null
   */
  async restoreCheckpoint(taskId: string, name: string): Promise<TaskGraph | null> {
    const graph = await this.store.restoreCheckpoint(taskId, name);
    if (!graph) {
      return null;
    }

    // Update status to indicate restoration
    graph.status = "pending";

    return graph;
  }

  /**
   * List all checkpoints for a task.
   *
   * @param taskId - Task ID
   * @returns Array of checkpoint metadata
   */
  async listCheckpoints(taskId: string): Promise<CheckpointMeta[]> {
    const names = await this.store.listCheckpoints(taskId);
    const metas: CheckpointMeta[] = [];

    for (const name of names) {
      const meta = await this.loadCheckpointMeta(taskId, name);
      if (meta) {
        metas.push(meta);
      }
    }

    // Sort by creation time, newest first
    return metas.toSorted((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Delete a checkpoint.
   *
   * @param taskId - Task ID
   * @param name - Checkpoint name
   * @returns true if deleted
   */
  async deleteCheckpoint(taskId: string, name: string): Promise<boolean> {
    // Delete metadata file
    const metaPath = this.getCheckpointMetaPath(taskId, name);
    try {
      const fs = await import("fs/promises");
      await fs.unlink(metaPath);
    } catch {
      // Meta file might not exist
    }

    // Note: TaskGraphStore doesn't have deleteCheckpoint, so we just delete meta
    return true;
  }

  /**
   * Create auto checkpoint if interval has elapsed.
   *
   * @param graph - Current TaskGraph
   * @returns Checkpoint metadata or null
   */
  async maybeAutoCheckpoint(graph: TaskGraph): Promise<CheckpointMeta | null> {
    if (this.autoCheckpointInterval <= 0) {
      return null;
    }

    const now = Date.now();
    if (now - this.lastAutoCheckpoint < this.autoCheckpointInterval) {
      return null;
    }

    this.lastAutoCheckpoint = now;
    const name = `auto-${now}`;

    return this.createCheckpoint(graph, name, "auto_scheduled", "Automatic checkpoint");
  }

  /**
   * Create checkpoint before critical steps.
   *
   * @param graph - TaskGraph
   * @param step - The critical step
   * @returns Checkpoint metadata
   */
  async checkpointBeforeStep(graph: TaskGraph, step: Step): Promise<CheckpointMeta> {
    const name = `before-${step.id}-${Date.now()}`;
    return this.createCheckpoint(
      graph,
      name,
      "before_critical_step",
      `Before executing step: ${step.desc}`,
    );
  }

  /**
   * Find the most recent checkpoint for a task.
   *
   * @param taskId - Task ID
   * @returns Most recent checkpoint metadata or null
   */
  async findLatestCheckpoint(taskId: string): Promise<CheckpointMeta | null> {
    const checkpoints = await this.listCheckpoints(taskId);
    return checkpoints.length > 0 ? checkpoints[0] : null;
  }

  /**
   * Get checkpoint statistics for a task.
   *
   * @param taskId - Task ID
   * @returns Checkpoint statistics
   */
  async getCheckpointStats(taskId: string): Promise<{
    count: number;
    oldestCheckpoint?: CheckpointMeta;
    newestCheckpoint?: CheckpointMeta;
  }> {
    const checkpoints = await this.listCheckpoints(taskId);

    return {
      count: checkpoints.length,
      oldestCheckpoint: checkpoints[checkpoints.length - 1],
      newestCheckpoint: checkpoints[0],
    };
  }

  /**
   * Save checkpoint metadata to disk.
   */
  private async saveCheckpointMeta(meta: CheckpointMeta): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    const metaPath = this.getCheckpointMetaPath(meta.taskId, meta.name);
    const metaDir = path.dirname(metaPath);

    await fs.mkdir(metaDir, { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  /**
   * Load checkpoint metadata from disk.
   */
  private async loadCheckpointMeta(taskId: string, name: string): Promise<CheckpointMeta | null> {
    const fs = await import("fs/promises");

    const metaPath = this.getCheckpointMetaPath(taskId, name);
    try {
      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content) as CheckpointMeta;
    } catch {
      return null;
    }
  }

  /**
   * Get the path for checkpoint metadata file.
   */
  private getCheckpointMetaPath(taskId: string, name: string): string {
    const config = getTaskGraphConfig();
    const baseDir = expandHomePrefix(config.checkpoints.storageDir);
    return `${baseDir}/${taskId}/${name}.meta.json`;
  }
}
