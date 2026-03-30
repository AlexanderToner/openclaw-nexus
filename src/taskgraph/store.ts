// src/taskgraph/store.ts
/**
 * TaskGraph Store
 *
 * Manages persistence and lifecycle of TaskGraph instances.
 * Supports save/load, status tracking, and recovery from checkpoints.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { TaskGraph } from "./types.js";

/**
 * TaskGraphStore handles persistence and management of TaskGraphs.
 */
export class TaskGraphStore {
  private storeDir: string;
  private cache: Map<string, TaskGraph> = new Map();

  constructor(storeDir: string) {
    this.storeDir = storeDir;
  }

  /**
   * Initialize the store directory.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
  }

  /**
   * Save a TaskGraph to disk.
   *
   * @param graph - The TaskGraph to save
   */
  async save(graph: TaskGraph): Promise<void> {
    const filePath = this.getFilePath(graph.taskId);
    const content = JSON.stringify(graph, null, 2);
    await fs.writeFile(filePath, content, "utf-8");
    this.cache.set(graph.taskId, graph);
  }

  /**
   * Load a TaskGraph from disk.
   *
   * @param taskId - The task ID to load
   * @returns The TaskGraph or null if not found
   */
  async load(taskId: string): Promise<TaskGraph | null> {
    // Check cache first
    const cached = this.cache.get(taskId);
    if (cached) {
      return cached;
    }

    const filePath = this.getFilePath(taskId);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const graph = JSON.parse(content) as TaskGraph;
      this.cache.set(taskId, graph);
      return graph;
    } catch {
      return null;
    }
  }

  /**
   * Delete a TaskGraph from disk and cache.
   *
   * @param taskId - The task ID to delete
   * @returns true if deleted, false if not found
   */
  async delete(taskId: string): Promise<boolean> {
    this.cache.delete(taskId);
    const filePath = this.getFilePath(taskId);
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all TaskGraph IDs in the store.
   *
   * @returns Array of task IDs
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.storeDir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  /**
   * List TaskGraphs by status.
   *
   * @param status - The status to filter by
   * @returns Array of task IDs with matching status
   */
  async listByStatus(status: TaskGraph["status"]): Promise<string[]> {
    const allIds = await this.list();
    const matching: string[] = [];

    for (const id of allIds) {
      const graph = await this.load(id);
      if (graph && graph.status === status) {
        matching.push(id);
      }
    }

    return matching;
  }

  /**
   * Update TaskGraph status.
   *
   * @param taskId - The task ID
   * @param status - The new status
   */
  async updateStatus(taskId: string, status: TaskGraph["status"]): Promise<boolean> {
    const graph = await this.load(taskId);
    if (!graph) {
      return false;
    }

    graph.status = status;
    await this.save(graph);
    return true;
  }

  /**
   * Update current step index.
   *
   * @param taskId - The task ID
   * @param stepIndex - The new step index
   */
  async updateStepIndex(taskId: string, stepIndex: number): Promise<boolean> {
    const graph = await this.load(taskId);
    if (!graph) {
      return false;
    }

    graph.currentStepIndex = stepIndex;
    await this.save(graph);
    return true;
  }

  /**
   * Increment replan count.
   *
   * @param taskId - The task ID
   * @returns The new replan count
   */
  async incrementReplanCount(taskId: string): Promise<number> {
    const graph = await this.load(taskId);
    if (!graph) {
      return -1;
    }

    graph.replanCount += 1;
    await this.save(graph);
    return graph.replanCount;
  }

  /**
   * Create a checkpoint for recovery.
   *
   * @param taskId - The task ID
   * @param checkpointName - Name for the checkpoint
   */
  async createCheckpoint(taskId: string, checkpointName: string): Promise<boolean> {
    const graph = await this.load(taskId);
    if (!graph) {
      return false;
    }

    const checkpointPath = this.getCheckpointPath(taskId, checkpointName);
    const checkpointDir = path.dirname(checkpointPath);

    // Ensure checkpoint directory exists
    await fs.mkdir(checkpointDir, { recursive: true });

    const content = JSON.stringify(graph, null, 2);
    await fs.writeFile(checkpointPath, content, "utf-8");
    return true;
  }

  /**
   * Restore from a checkpoint.
   *
   * @param taskId - The task ID
   * @param checkpointName - Name of the checkpoint
   * @returns The restored TaskGraph or null
   */
  async restoreCheckpoint(taskId: string, checkpointName: string): Promise<TaskGraph | null> {
    const checkpointPath = this.getCheckpointPath(taskId, checkpointName);
    try {
      const content = await fs.readFile(checkpointPath, "utf-8");
      const graph = JSON.parse(content) as TaskGraph;
      await this.save(graph);
      return graph;
    } catch {
      return null;
    }
  }

  /**
   * List available checkpoints for a task.
   *
   * @param taskId - The task ID
   * @returns Array of checkpoint names
   */
  async listCheckpoints(taskId: string): Promise<string[]> {
    const checkpointDir = path.join(this.storeDir, "checkpoints", taskId);
    try {
      const files = await fs.readdir(checkpointDir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  /**
   * Clear the in-memory cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the file path for a TaskGraph.
   */
  private getFilePath(taskId: string): string {
    return path.join(this.storeDir, `${taskId}.json`);
  }

  /**
   * Get the file path for a checkpoint.
   */
  private getCheckpointPath(taskId: string, checkpointName: string): string {
    const checkpointDir = path.join(this.storeDir, "checkpoints", taskId);
    return path.join(checkpointDir, `${checkpointName}.json`);
  }
}

/**
 * Generate a unique task ID.
 */
export function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `task-${timestamp}-${random}`;
}

/**
 * Default TaskGraph store directory.
 */
export const DEFAULT_STORE_DIR = path.join(process.env.HOME ?? "~", ".openclaw", "taskgraphs");
