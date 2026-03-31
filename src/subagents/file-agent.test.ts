import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
// src/subagents/file-agent.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Step, FileAction } from "../taskgraph/types.js";
import { FileAgent } from "./file-agent.js";
import type { SubAgentContext } from "./types.js";

describe("FileAgent", () => {
  let agent: FileAgent;
  let testDir: string;
  let context: SubAgentContext;

  beforeEach(async () => {
    agent = new FileAgent();
    testDir = path.join(os.tmpdir(), `file-agent-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    context = {
      taskId: "test-task",
      workingDir: testDir,
      timeoutMs: 5000,
      state: new Map<string, unknown>(),
      env: {},
    };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("canHandle", () => {
    it("returns true for file steps", () => {
      const step = createStep("s1", { op: "read", path: "/tmp/test.txt" });
      expect(agent.canHandle(step)).toBe(true);
    });

    it("returns false for non-file steps", () => {
      const step = {
        ...createStep("s1", { op: "read", path: "/tmp/test.txt" }),
        type: "shell" as const,
      };
      expect(agent.canHandle(step)).toBe(false);
    });
  });

  describe("read operation", () => {
    it("reads file content", async () => {
      const filePath = path.join(testDir, "test.txt");
      await fs.writeFile(filePath, "Hello World");

      const step = createStep("s1", { op: "read", path: "test.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        content: "Hello World",
        size: 11,
      });
    });

    it("handles absolute paths", async () => {
      const filePath = path.join(testDir, "abs-test.txt");
      await fs.writeFile(filePath, "Absolute Path Test");

      const step = createStep("s1", { op: "read", path: filePath });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        content: "Absolute Path Test",
      });
    });

    it("fails for non-existent file", async () => {
      const step = createStep("s1", { op: "read", path: "nonexistent.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.type).toBe("resource_not_found");
    });
  });

  describe("write operation", () => {
    it("writes content to file", async () => {
      const step = createStep("s1", { op: "write", path: "output.txt", content: "Test content" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        bytesWritten: 12,
      });

      // Verify file was created
      const content = await fs.readFile(path.join(testDir, "output.txt"), "utf-8");
      expect(content).toBe("Test content");
    });

    it("creates parent directories", async () => {
      const step = createStep("s1", {
        op: "write",
        path: "subdir/deep/nested.txt",
        content: "Nested content",
      });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");

      // Verify nested file was created
      const content = await fs.readFile(path.join(testDir, "subdir/deep/nested.txt"), "utf-8");
      expect(content).toBe("Nested content");
    });

    it("fails without content", async () => {
      const step = createStep("s1", { op: "write", path: "output.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Content is required");
    });
  });

  describe("list operation", () => {
    it("lists directory contents", async () => {
      await fs.mkdir(path.join(testDir, "dir1"));
      await fs.writeFile(path.join(testDir, "file1.txt"), "content");
      await fs.writeFile(path.join(testDir, "file2.txt"), "content");

      const step = createStep("s1", { op: "list", path: "." });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        path: testDir,
      });

      const entries = (result.output as { entries: Array<{ name: string; type: string }> }).entries;
      expect(entries).toHaveLength(3);
      expect(entries.find((e) => e.name === "dir1")?.type).toBe("directory");
      expect(entries.find((e) => e.name === "file1.txt")?.type).toBe("file");
    });

    it("handles empty directory", async () => {
      await fs.mkdir(path.join(testDir, "empty-dir"));

      const step = createStep("s1", { op: "list", path: "empty-dir" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      const entries = (result.output as { entries: Array<{ name: string }> }).entries;
      expect(entries).toHaveLength(0);
    });
  });

  describe("move operation", () => {
    it("moves file to new location", async () => {
      await fs.writeFile(path.join(testDir, "source.txt"), "Move me");

      const step = createStep("s1", { op: "move", src: "source.txt", dst: "destination.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");

      // Verify source no longer exists
      await expect(fs.readFile(path.join(testDir, "source.txt"))).rejects.toThrow();

      // Verify destination exists
      const content = await fs.readFile(path.join(testDir, "destination.txt"), "utf-8");
      expect(content).toBe("Move me");
    });

    it("moves to nested destination", async () => {
      await fs.writeFile(path.join(testDir, "source.txt"), "Move nested");

      const step = createStep("s1", {
        op: "move",
        src: "source.txt",
        dst: "newdir/nested/file.txt",
      });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      const content = await fs.readFile(path.join(testDir, "newdir/nested/file.txt"), "utf-8");
      expect(content).toBe("Move nested");
    });

    it("fails without src or dst", async () => {
      const step = createStep("s1", { op: "move", src: "source.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Source and destination");
    });
  });

  describe("copy operation", () => {
    it("copies file to new location", async () => {
      await fs.writeFile(path.join(testDir, "original.txt"), "Copy me");

      const step = createStep("s1", { op: "copy", src: "original.txt", dst: "copy.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");

      // Verify both exist
      const original = await fs.readFile(path.join(testDir, "original.txt"), "utf-8");
      const copy = await fs.readFile(path.join(testDir, "copy.txt"), "utf-8");
      expect(original).toBe("Copy me");
      expect(copy).toBe("Copy me");
    });
  });

  describe("delete operation", () => {
    it("deletes file", async () => {
      await fs.writeFile(path.join(testDir, "to-delete.txt"), "Delete me");

      const step = createStep("s1", { op: "delete", path: "to-delete.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      await expect(fs.readFile(path.join(testDir, "to-delete.txt"))).rejects.toThrow();
    });

    it("deletes directory recursively", async () => {
      const dirPath = path.join(testDir, "dir-to-delete");
      await fs.mkdir(dirPath);
      await fs.writeFile(path.join(dirPath, "file.txt"), "Delete this too");

      const step = createStep("s1", { op: "delete", path: "dir-to-delete" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      await expect(fs.stat(dirPath)).rejects.toThrow();
    });
  });

  describe("mkdir operation", () => {
    it("creates directory", async () => {
      const step = createStep("s1", { op: "mkdir", path: "new-dir" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      const stats = await fs.stat(path.join(testDir, "new-dir"));
      expect(stats.isDirectory()).toBe(true);
    });

    it("creates nested directories", async () => {
      const step = createStep("s1", { op: "mkdir", path: "deep/nested/path" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      const stats = await fs.stat(path.join(testDir, "deep/nested/path"));
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("fails for unknown operation", async () => {
      const step = createStep("s1", { op: "unknown" as "read", path: "test.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Unknown file operation");
    });

    it("fails for missing path", async () => {
      const step = createStep("s1", { op: "read" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Path is required");
    });

    it("handles permission denied", async () => {
      // Create a file we can't read (on Unix)
      if (process.platform === "win32") {
        // Skip on Windows
        return;
      }

      const filePath = path.join(testDir, "no-permission.txt");
      await fs.writeFile(filePath, "Secret");
      await fs.chmod(filePath, 0o000);

      const step = createStep("s1", { op: "read", path: "no-permission.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.type).toBe("permission_denied");

      // Restore permission for cleanup
      await fs.chmod(filePath, 0o644);
    });
  });

  describe("security arbiter", () => {
    it("checks path with security arbiter", async () => {
      const deniedPath = path.join(testDir, "denied.txt");
      await fs.writeFile(deniedPath, "Denied content");

      context.securityArbiter = {
        checkPath: (p: string) => ({
          allowed: !p.includes("denied"),
          reason: "Path not allowed",
          rule: "test-rule",
        }),
        checkCommand: () => ({ allowed: true }),
        checkDomain: () => ({ allowed: true }),
        checkPort: () => ({ allowed: true }),
      };

      const step = createStep("s1", { op: "read", path: "denied.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Path access denied");
    });

    it("allows permitted paths", async () => {
      await fs.writeFile(path.join(testDir, "allowed.txt"), "Allowed content");

      context.securityArbiter = {
        checkPath: () => ({ allowed: true }),
        checkCommand: () => ({ allowed: true }),
        checkDomain: () => ({ allowed: true }),
        checkPort: () => ({ allowed: true }),
      };

      const step = createStep("s1", { op: "read", path: "allowed.txt" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
    });
  });

  describe("metadata", () => {
    it("includes duration in result", async () => {
      const step = createStep("s1", { op: "write", path: "timing.txt", content: "test" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

function createStep(id: string, action: Partial<FileAction>): Step {
  return {
    id,
    type: "file",
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action: {
      op: action.op ?? "read",
      path: action.path,
      src: action.src,
      dst: action.dst,
      content: action.content,
    },
  } as Step;
}
