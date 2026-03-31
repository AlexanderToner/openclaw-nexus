import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
// src/subagents/shell-agent.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Step, ShellAction } from "../taskgraph/types.js";
import { ShellAgent } from "./shell-agent.js";
import type { SubAgentContext } from "./types.js";

describe("ShellAgent", () => {
  let agent: ShellAgent;
  let testDir: string;
  let context: SubAgentContext;
  let securityArbiter: MockSecurityArbiter;

  beforeEach(async () => {
    agent = new ShellAgent();
    testDir = path.join(os.tmpdir(), `shell-agent-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    securityArbiter = new MockSecurityArbiter();
    securityArbiter.allowCommand("echo");
    securityArbiter.allowCommand("ls");
    securityArbiter.allowCommand("cat");
    securityArbiter.allowCommand("pwd");
    securityArbiter.allowCommand("mkdir");

    context = {
      taskId: "test-task",
      workingDir: testDir,
      timeoutMs: 5000,
      state: new Map<string, unknown>(),
      env: {},
      securityArbiter,
    };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("canHandle", () => {
    it("returns true for shell steps", () => {
      const step = createStep("s1", { command: "echo test" });
      expect(agent.canHandle(step)).toBe(true);
    });

    it("returns false for non-shell steps", () => {
      const step = { ...createStep("s1", { command: "echo test" }), type: "file" as const };
      expect(agent.canHandle(step)).toBe(false);
    });
  });

  describe("execute", () => {
    it("executes allowed echo command", async () => {
      const step = createStep("s1", { command: "echo", args: ["Hello World"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        stdout: "Hello World\n",
        exitCode: 0,
      });
    });

    it("executes ls command", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "content");

      const step = createStep("s1", { command: "ls", args: ["-la"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        exitCode: 0,
      });
      expect((result.output as { stdout: string }).stdout).toContain("test.txt");
    });

    it("executes pwd command", async () => {
      const step = createStep("s1", { command: "pwd" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      // macOS returns /private/var for /var symlink
      const actualPath = (result.output as { stdout: string }).stdout.trim();
      expect(actualPath).toMatch(/shell-agent-test-/);
    });

    it("executes cat command", async () => {
      const filePath = path.join(testDir, "readme.txt");
      await fs.writeFile(filePath, "Read this content");

      const step = createStep("s1", { command: "cat", args: ["readme.txt"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect((result.output as { stdout: string }).stdout).toBe("Read this content");
    });

    it("executes mkdir command", async () => {
      const step = createStep("s1", { command: "mkdir", args: ["subdir"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");

      // Verify directory was created
      const stat = await fs.stat(path.join(testDir, "subdir"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("security", () => {
    it("rejects command not in whitelist", async () => {
      const step = createStep("s1", { command: "rm" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("blocked by security policy");
    });

    it("rejects command with security blocked error type", async () => {
      const step = createStep("s1", { command: "dangerous-command" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.type).toBe("security_blocked");
    });

    it("fails without security arbiter", async () => {
      const step = createStep("s1", { command: "echo test" });
      const noSecurityContext: SubAgentContext = {
        taskId: "test",
        workingDir: testDir,
        timeoutMs: 5000,
        state: new Map(),
      };

      const result = await agent.execute(step, noSecurityContext);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("No security arbiter");
    });
  });

  describe("environment", () => {
    it("passes custom environment variables", async () => {
      context.env = { MY_VAR: "custom_value" };

      const step = createStep("s1", { command: "echo", args: ["$MY_VAR"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect((result.output as { stdout: string }).stdout.trim()).toBe("custom_value");
    });
  });

  describe("working directory", () => {
    it("uses context workingDir as default cwd", async () => {
      const step = createStep("s1", { command: "pwd" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      // macOS returns /private/var for /var symlink
      const actualPath = (result.output as { stdout: string }).stdout.trim();
      expect(actualPath).toMatch(/shell-agent-test-/);
    });

    it("supports custom cwd in action", async () => {
      const subdir = path.join(testDir, "custom-cwd");
      await fs.mkdir(subdir);

      const step = createStep("s1", { command: "pwd", cwd: subdir });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      const actualPath = (result.output as { stdout: string }).stdout.trim();
      expect(actualPath).toMatch(/custom-cwd$/);
    });
  });

  describe("error handling", () => {
    it("handles command failure with non-zero exit code", async () => {
      securityArbiter.allowCommand("false"); // Command that always returns non-zero

      const step = createStep("s1", { command: "false" });
      const result = await agent.execute(step, context);

      // Command failed but execution succeeded (we captured the error)
      expect(result.status).toBe("success");
      expect((result.output as { exitCode: number }).exitCode).not.toBe(0);
    });

    it("handles timeout", async () => {
      securityArbiter.allowCommand("sleep");

      const step = createStep("s1", { command: "sleep", args: ["10"] });
      const shortTimeoutContext: SubAgentContext = {
        ...context,
        timeoutMs: 100,
      };

      const result = await agent.execute(step, shortTimeoutContext);

      expect(result.status).toBe("failed");
      // Timeout errors may be classified as timeout or execution_error
      expect(["timeout", "execution_error"]).toContain(result.error?.type);
    });

    it("includes duration in metadata", async () => {
      const step = createStep("s1", { command: "echo", args: ["test"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("output", () => {
    it("captures stdout", async () => {
      const step = createStep("s1", { command: "echo", args: ["hello world"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect((result.output as { stdout: string }).stdout.trim()).toBe("hello world");
    });

    it("returns full command in output", async () => {
      const step = createStep("s1", { command: "echo", args: ["hello", "world"] });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect((result.output as { command: string }).command).toBe("echo hello world");
    });
  });
});

/**
 * Mock security arbiter for testing.
 */
class MockSecurityArbiter {
  private allowedCommands: Set<string> = new Set();

  allowCommand(command: string): void {
    this.allowedCommands.add(command);
  }

  checkCommand(command: string): { allowed: boolean; reason?: string } {
    const baseCommand = command.split(" ")[0];
    const allowed = this.allowedCommands.has(baseCommand);
    return {
      allowed,
      reason: allowed ? undefined : `Command '${baseCommand}' not in whitelist`,
    };
  }

  checkPath(_path: string): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }

  checkDomain(_domain: string): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }

  checkPort(_port: number): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }
}

function createStep(id: string, action: Partial<ShellAction>): Step {
  return {
    id,
    type: "shell",
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action: {
      command: action.command ?? "echo",
      args: action.args,
      cwd: action.cwd,
    },
  } as Step;
}
