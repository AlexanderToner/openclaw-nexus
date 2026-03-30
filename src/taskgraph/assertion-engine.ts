// src/taskgraph/assertion-engine.ts
/**
 * Assertion Engine
 *
 * Evaluates goal assertions to determine if a task has been completed.
 * This enables deterministic completion checking without LLM judgment.
 */

import * as fs from "fs/promises";
import type { Assertion } from "./types.js";

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
 * - custom: Custom command-based check
 */
export class AssertionEngine {
  /**
   * Evaluate an assertion and return true/false result.
   *
   * @param assertion - The assertion to evaluate
   * @returns true if assertion passes, false otherwise
   */
  async evaluate(assertion: Assertion): Promise<boolean> {
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
          return await this.checkAllOf(assertion);

        case "any_of":
          return await this.checkAnyOf(assertion);

        case "custom":
          return await this.checkCustom(assertion);

        default: {
          const unknownType = (assertion as { type: string }).type;
          console.warn(`[AssertionEngine] Unknown assertion type: ${unknownType}`);
          return false;
        }
      }
    } catch (error) {
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
  private async checkAllOf(assertion: Assertion): Promise<boolean> {
    if (!assertion.conditions || assertion.conditions.length === 0) {
      return true;
    }

    for (const condition of assertion.conditions) {
      const result = await this.evaluate(condition);
      if (!result) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if any condition passes.
   */
  private async checkAnyOf(assertion: Assertion): Promise<boolean> {
    if (!assertion.conditions || assertion.conditions.length === 0) {
      return false;
    }

    for (const condition of assertion.conditions) {
      const result = await this.evaluate(condition);
      if (result) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check custom command assertion.
   */
  private async checkCustom(assertion: Assertion): Promise<boolean> {
    // Custom assertions would need to execute a command or script
    // This is a placeholder for future implementation
    console.warn(
      `[AssertionEngine] Custom assertions not yet implemented: ${assertion.description}`,
    );
    return false;
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
