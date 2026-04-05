// src/taskgraph/assertion-engine.ts
/**
 * Assertion Engine
 *
 * Evaluates goal assertions to determine if a task has been completed.
 * This enables deterministic completion checking without LLM judgment.
 */

import * as fs from "fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Assertion, AssertionType } from "./types.js";

const execAsync = promisify(exec);

export type VerificationStatus = "passed" | "failed" | "uncertain";

export interface VerificationResult {
  status: VerificationStatus;
  reason: string;
  snapshotUsed?: string;
}

export interface AssertionErrorContext {
  /** The assertion that triggered the error */
  assertion: Assertion;
  /** DOM snapshot available at verification time */
  domSnapshot?: string;
  /** Available alternative assertion types */
  availableTypes: AssertionType[];
  /** VisualContext capture timestamp (ms) when command === "__vision_check__" */
  visionCapturedAt?: number;
}

export interface AssertionErrorLayer {
  level: "error" | "context" | "state" | "actionable";
  content: string;
}

export class AssertionError extends Error {
  constructor(
    public readonly context: AssertionErrorContext,
    public readonly layers: AssertionErrorLayer[],
  ) {
    super(layers.map((l) => l.content).join("\n"));
    this.name = "AssertionError";
  }
}

const SUPPORTED_ASSERTION_TYPES: AssertionType[] = [
  "file_exists",
  "file_count_equals",
  "directory_not_empty",
  "file_contains",
  "all_of",
  "any_of",
];

/**
 * AssertionEngine evaluates structured assertions to verify goal completion.
 *
 * Supported assertion types:
 * - file_exists: Check if a file exists
 * - file_count_equals: Check if directory has exact number of files
 * - directory_not_empty: Check if directory has any files
 * - file_contains: Check if file contains specific text
 * - all_of: All conditions must pass
 * - any_of: Any condition must pass
 * - custom: Custom command-based check (throws AssertionError without command)
 */
export class AssertionEngine {
  /**
   * Evaluate an assertion and return true/false result.
   *
   * @param assertion - The assertion to evaluate
   * @param domSnapshot - Optional DOM snapshot for custom assertion error context
   * @returns true if assertion passes, false otherwise
   */
  async evaluate(
    assertion: Assertion,
    domSnapshot?: string,
    capturedAt?: number,
  ): Promise<boolean> {
    try {
      switch (assertion.type) {
        case "file_exists":
          return await this.checkFileExists(assertion);

        case "file_count_equals":
          return await this.checkFileCount(assertion);

        case "directory_not_empty":
          return await this.checkDirectoryNotEmpty(assertion);

        case "file_contains":
          return await this.checkFileContains(assertion);

        case "all_of":
          return await this.checkAllOf(assertion, domSnapshot, capturedAt);

        case "any_of":
          return await this.checkAnyOf(assertion, domSnapshot, capturedAt);

        case "custom":
          return await this.checkCustom(assertion, domSnapshot, capturedAt);

        default: {
          const unknownType = (assertion as { type: string }).type;
          console.warn(`[AssertionEngine] Unknown assertion type: ${unknownType}`);
          return false;
        }
      }
    } catch (error) {
      // AssertionError propagates to Planner callers who need structured context.
      // All other errors are swallowed and treated as assertion failure.
      if (error instanceof AssertionError) {
        console.warn(`[AssertionEngine] Assertion failed: ${error.message}`);
        return false;
      }
      console.error(`[AssertionEngine] Error evaluating assertion:`, error);
      return false;
    }
  }

  /**
   * Evaluate assertion and return detailed result.
   */
  async evaluateDetailed(assertion: Assertion): Promise<{ passed: boolean; reason: string }> {
    try {
      const result = await this.evaluate(assertion);
      return {
        passed: result,
        reason: result
          ? `Assertion '${assertion.description}' passed`
          : `Assertion '${assertion.description}' failed`,
      };
    } catch (error) {
      return {
        passed: false,
        reason: `Error: ${String(error)}`,
      };
    }
  }

  /**
   * Check if a file exists.
   */
  private async checkFileExists(assertion: Assertion): Promise<boolean> {
    if (!assertion.path) {
      return false;
    }

    const expandedPath = this.expandPath(assertion.path);
    try {
      await fs.access(expandedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if directory has expected number of files.
   */
  private async checkFileCount(assertion: Assertion): Promise<boolean> {
    if (!assertion.path || assertion.expected === undefined) {
      return false;
    }

    const expandedPath = this.expandPath(assertion.path);
    try {
      const entries = await fs.readdir(expandedPath);
      // Filter out hidden files
      const visibleFiles = entries.filter((e) => !e.startsWith("."));
      return visibleFiles.length === assertion.expected;
    } catch {
      return false;
    }
  }

  /**
   * Check if directory is not empty.
   */
  private async checkDirectoryNotEmpty(assertion: Assertion): Promise<boolean> {
    if (!assertion.path) {
      return false;
    }

    const expandedPath = this.expandPath(assertion.path);
    try {
      const entries = await fs.readdir(expandedPath);
      // Filter out hidden files
      const visibleFiles = entries.filter((e) => !e.startsWith("."));
      return visibleFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if file contains specific text.
   */
  private async checkFileContains(assertion: Assertion): Promise<boolean> {
    if (!assertion.path || !assertion.expected) {
      return false;
    }

    const expandedPath = this.expandPath(assertion.path);
    try {
      const content = await fs.readFile(expandedPath, "utf-8");
      return content.includes(String(assertion.expected));
    } catch {
      return false;
    }
  }

  /**
   * Check if all conditions pass.
   */
  private async checkAllOf(
    assertion: Assertion,
    domSnapshot?: string,
    capturedAt?: number,
  ): Promise<boolean> {
    if (!assertion.conditions || assertion.conditions.length === 0) {
      return true;
    }

    for (const condition of assertion.conditions) {
      const result = await this.evaluate(condition, domSnapshot, capturedAt);
      if (!result) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if any condition passes.
   */
  private async checkAnyOf(
    assertion: Assertion,
    domSnapshot?: string,
    capturedAt?: number,
  ): Promise<boolean> {
    if (!assertion.conditions || assertion.conditions.length === 0) {
      return false;
    }

    for (const condition of assertion.conditions) {
      const result = await this.evaluate(condition, domSnapshot, capturedAt);
      if (result) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check custom command assertion.
   * Throws AssertionError with 4-layer context when no command is provided.
   * Executes shell command when command is provided.
   */
  private async checkCustom(
    assertion: Assertion,
    domSnapshot?: string,
    capturedAt?: number,
  ): Promise<boolean> {
    // "__vision_check__" signals intent to escalate to VisionVerificationHook.
    // It should never reach the shell executor — throw a vision-specific error.
    const isVisionCheck = assertion.command === "__vision_check__";
    if (!assertion.command || isVisionCheck) {
      const layers: AssertionErrorLayer[] = [
        {
          level: "error",
          content: isVisionCheck
            ? `Vision check requested (__vision_check__) but vision-bridge plugin is unavailable.`
            : `Custom assertion type requires a 'command' field for deterministic verification. ` +
              `Received no command for goal: "${assertion.description}".`,
        },
        {
          level: "context",
          content: `Original goal: "${assertion.description}"`,
        },
        {
          level: "state",
          content: domSnapshot
            ? `Current DOM snapshot (first 500 chars): ${domSnapshot.slice(0, 500)}...`
            : `No DOM snapshot available at this point.`,
        },
        {
          level: "actionable",
          content:
            isVisionCheck && capturedAt !== undefined
              ? `Vision check captured at ${new Date(capturedAt).toISOString()} (ts=${capturedAt}). ` +
                `LLM-based visual verification requires the vision-bridge plugin to be enabled. ` +
                `Escalate to VisionVerificationHook for Phase 2 support.`
              : `Supported assertion types: file_exists, file_count_equals, ` +
                `directory_not_empty, file_contains, all_of, any_of. ` +
                `For browser tasks, prefer file_contains (verify API response) or all_of ` +
                `(combine multiple checks). ` +
                `Set assertion.command to "__vision_check__" to enable LLM-based ` +
                `visual verification when the vision-bridge plugin is available.`,
        },
      ];

      throw new AssertionError(
        {
          assertion,
          domSnapshot,
          availableTypes: SUPPORTED_ASSERTION_TYPES,
          visionCapturedAt: isVisionCheck ? capturedAt : undefined,
        },
        layers,
      );
    }

    return await this.checkShellCommand(assertion.command);
  }

  /**
   * Execute a shell command for custom assertion verification.
   * Returns true if the command exits with code 0 (no stderr).
   */
  private async checkShellCommand(command: string): Promise<boolean> {
    try {
      const { stderr } = await execAsync(command, { timeout: 5000 });
      return stderr.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * Expand path with home directory.
   */
  private expandPath(p: string): string {
    if (p.startsWith("~/")) {
      return p.replace("~", process.env.HOME ?? "~");
    }
    return p;
  }
}
