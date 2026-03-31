// src/subagents/file-agent.ts
/**
 * FileAgent
 *
 * Handles file system operations: read, write, list, move, copy, delete, mkdir.
 * Uses minimal context to reduce token consumption.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Step, FileAction } from "../taskgraph/types.js";
import { createSubAgentError } from "./errors.js";
import type { SubAgent, SubAgentContext, SubAgentResult } from "./types.js";

/**
 * FileAgent handles all file system operations.
 *
 * Operations:
 * - read: Read file contents
 * - write: Write content to file
 * - list: List directory contents
 * - move: Move file/directory
 * - copy: Copy file
 * - delete: Delete file/directory
 * - mkdir: Create directory
 */
export class FileAgent implements SubAgent {
  type = "file" as const;
  name = "file-agent";
  description = "Handles file system operations";

  /**
   * Check if this agent can handle a step.
   */
  canHandle(step: Step): boolean {
    return step.type === "file";
  }

  /**
   * Execute a file operation step.
   */
  async execute(step: Step, context: SubAgentContext): Promise<SubAgentResult> {
    const action = step.action as FileAction;
    const startTime = Date.now();

    try {
      const result = await this.executeAction(action, context);

      return {
        stepId: step.id,
        status: "success",
        output: result,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      const classifiedError = createSubAgentError(error);

      return {
        stepId: step.id,
        status: "failed",
        error: classifiedError,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute a specific file action.
   */
  private async executeAction(action: FileAction, context: SubAgentContext): Promise<unknown> {
    const workingDir = context.workingDir;

    switch (action.op) {
      case "read":
        return this.readFile(action, workingDir, context);

      case "write":
        return this.writeFile(action, workingDir, context);

      case "list":
        return this.listDirectory(action, workingDir, context);

      case "move":
        return this.moveFile(action, workingDir, context);

      case "copy":
        return this.copyFile(action, workingDir, context);

      case "delete":
        return this.deleteFile(action, workingDir, context);

      case "mkdir":
        return this.makeDirectory(action, workingDir, context);

      default: {
        const _exhaustive: never = action.op;
        throw new Error(`Unknown file operation: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Resolve a path relative to working directory and check security.
   */
  private resolvePath(
    filePath: string | undefined,
    workingDir: string,
    context: SubAgentContext,
  ): string {
    if (!filePath) {
      throw new Error("Path is required for file operations");
    }

    // Resolve relative to working directory
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath);

    // Security check
    if (context.securityArbiter) {
      const checkResult = context.securityArbiter.checkPath(resolvedPath);
      if (!checkResult.allowed) {
        throw new Error(`Path access denied: ${checkResult.reason || "Security policy"}`);
      }
    }

    return resolvedPath;
  }

  /**
   * Read file contents.
   */
  private async readFile(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ content: string; path: string; size: number }> {
    const filePath = this.resolvePath(action.path, workingDir, context);

    const content = await fs.readFile(filePath, "utf-8");
    const stats = await fs.stat(filePath);

    return {
      content,
      path: filePath,
      size: stats.size,
    };
  }

  /**
   * Write content to file.
   */
  private async writeFile(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ path: string; bytesWritten: number }> {
    if (!action.content) {
      throw new Error("Content is required for write operation");
    }

    const filePath = this.resolvePath(action.path, workingDir, context);

    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    await fs.mkdir(parentDir, { recursive: true });

    await fs.writeFile(filePath, action.content, "utf-8");

    return {
      path: filePath,
      bytesWritten: Buffer.byteLength(action.content, "utf-8"),
    };
  }

  /**
   * List directory contents.
   */
  private async listDirectory(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ path: string; entries: DirectoryEntry[] }> {
    const dirPath = this.resolvePath(action.path, workingDir, context);

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result: DirectoryEntry[] = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
    }));

    return {
      path: dirPath,
      entries: result,
    };
  }

  /**
   * Move file or directory.
   */
  private async moveFile(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ src: string; dst: string }> {
    if (!action.src || !action.dst) {
      throw new Error("Source and destination paths are required for move operation");
    }

    const srcPath = this.resolvePath(action.src, workingDir, context);
    const dstPath = this.resolvePath(action.dst, workingDir, context);

    // Ensure destination parent exists
    const parentDir = path.dirname(dstPath);
    await fs.mkdir(parentDir, { recursive: true });

    await fs.rename(srcPath, dstPath);

    return {
      src: srcPath,
      dst: dstPath,
    };
  }

  /**
   * Copy file.
   */
  private async copyFile(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ src: string; dst: string }> {
    if (!action.src || !action.dst) {
      throw new Error("Source and destination paths are required for copy operation");
    }

    const srcPath = this.resolvePath(action.src, workingDir, context);
    const dstPath = this.resolvePath(action.dst, workingDir, context);

    // Ensure destination parent exists
    const parentDir = path.dirname(dstPath);
    await fs.mkdir(parentDir, { recursive: true });

    await fs.copyFile(srcPath, dstPath);

    return {
      src: srcPath,
      dst: dstPath,
    };
  }

  /**
   * Delete file or directory.
   */
  private async deleteFile(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ path: string }> {
    const filePath = this.resolvePath(action.path, workingDir, context);

    // Check if it's a directory or file
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }

    return {
      path: filePath,
    };
  }

  /**
   * Create directory.
   */
  private async makeDirectory(
    action: FileAction,
    workingDir: string,
    context: SubAgentContext,
  ): Promise<{ path: string }> {
    const dirPath = this.resolvePath(action.path, workingDir, context);

    await fs.mkdir(dirPath, { recursive: true });

    return {
      path: dirPath,
    };
  }
}

/**
 * Directory entry returned by list operation.
 */
export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
}
