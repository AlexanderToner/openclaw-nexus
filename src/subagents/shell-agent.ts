// src/subagents/shell-agent.ts
/**
 * ShellAgent
 *
 * Handles shell command execution with security restrictions.
 * Commands must pass through security arbiter whitelist.
 */

import * as childProcess from "node:child_process";
import { promisify } from "node:util";
import type { Step, ShellAction } from "../taskgraph/types.js";
import { createSubAgentError } from "./errors.js";
import type { SubAgent, SubAgentContext, SubAgentResult } from "./types.js";

const execAsync = promisify(childProcess.exec);

/**
 * ShellAgent handles command execution with security restrictions.
 *
 * Security:
 * - All commands must pass security arbiter whitelist
 * - Commands run in sandboxed working directory
 * - Timeout enforced by context
 */
export class ShellAgent implements SubAgent {
  type = "shell" as const;
  name = "shell-agent";
  description = "Handles shell command execution with security restrictions";

  /**
   * Check if this agent can handle a step.
   */
  canHandle(step: Step): boolean {
    return step.type === "shell";
  }

  /**
   * Execute a shell command step.
   */
  async execute(step: Step, context: SubAgentContext): Promise<SubAgentResult> {
    const action = step.action as ShellAction;
    const startTime = Date.now();

    try {
      // Security check
      this.checkSecurity(action, context);

      const result = await this.executeCommand(action, context);

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
   * Check command against security arbiter.
   */
  private checkSecurity(action: ShellAction, context: SubAgentContext): void {
    if (!context.securityArbiter) {
      throw new Error("No security arbiter configured for shell execution");
    }

    const checkResult = context.securityArbiter.checkCommand(action.command);
    if (!checkResult.allowed) {
      throw new Error(
        `Command blocked by security policy: ${action.command}. Reason: ${checkResult.reason || "Not in whitelist"}`,
      );
    }
  }

  /**
   * Execute the shell command.
   */
  private async executeCommand(
    action: ShellAction,
    context: SubAgentContext,
  ): Promise<ShellResult> {
    const timeoutMs = context.timeoutMs;
    const cwd = action.cwd ?? context.workingDir;

    // Build full command with args
    const fullCommand = action.args ? `${action.command} ${action.args.join(" ")}` : action.command;

    // Merge environment
    const env = { ...process.env, ...context.env };

    try {
      const { stdout, stderr } = await execAsync(fullCommand, {
        cwd,
        timeout: timeoutMs,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        command: fullCommand,
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error) {
      // Check for timeout (killed = true)
      if (error instanceof Error && "killed" in error && (error as ExecError).killed) {
        throw new Error(`Command timed out after ${timeoutMs}ms`, { cause: error });
      }

      // Handle exec error with exit code
      if (error instanceof Error && "code" in error) {
        const execError = error as ExecError;
        return {
          command: fullCommand,
          stdout: execError.stdout ?? "",
          stderr: execError.stderr ?? "",
          exitCode: typeof execError.code === "number" ? execError.code : 1,
        };
      }
      throw error;
    }
  }
}

/**
 * Result from shell command execution.
 */
export interface ShellResult {
  /** Command that was executed */
  command: string;

  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Exit code (0 for success) */
  exitCode: number;
}

/**
 * Extended error from exec with stdout/stderr.
 */
interface ExecError extends Error {
  code?: number | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}
