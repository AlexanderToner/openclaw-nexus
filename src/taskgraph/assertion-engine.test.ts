import * as fs from "fs/promises";
import * as path from "path";
// src/taskgraph/assertion-engine.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AssertionEngine } from "./assertion-engine.js";
import type { Assertion } from "./types.js";

describe("AssertionEngine", () => {
  const testDir = "/tmp/assertion-engine-test";
  let engine: AssertionEngine;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    engine = new AssertionEngine();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("file_exists", () => {
    it("returns true when file exists", async () => {
      const filePath = path.join(testDir, "exists.txt");
      await fs.writeFile(filePath, "content");

      const assertion: Assertion = {
        type: "file_exists",
        path: filePath,
        description: "File should exist",
      };

      expect(await engine.evaluate(assertion)).toBe(true);
    });

    it("returns false when file does not exist", async () => {
      const assertion: Assertion = {
        type: "file_exists",
        path: path.join(testDir, "nonexistent.txt"),
        description: "File should exist",
      };

      expect(await engine.evaluate(assertion)).toBe(false);
    });
  });

  describe("file_count_equals", () => {
    it("returns true when file count matches", async () => {
      await fs.writeFile(path.join(testDir, "a.txt"), "a");
      await fs.writeFile(path.join(testDir, "b.txt"), "b");

      const assertion: Assertion = {
        type: "file_count_equals",
        path: testDir,
        expected: 2,
        description: "Should have 2 files",
      };

      expect(await engine.evaluate(assertion)).toBe(true);
    });

    it("returns false when file count does not match", async () => {
      await fs.writeFile(path.join(testDir, "a.txt"), "a");

      const assertion: Assertion = {
        type: "file_count_equals",
        path: testDir,
        expected: 5,
        description: "Should have 5 files",
      };

      expect(await engine.evaluate(assertion)).toBe(false);
    });
  });

  describe("directory_not_empty", () => {
    it("returns true when directory has files", async () => {
      await fs.writeFile(path.join(testDir, "file.txt"), "content");

      const assertion: Assertion = {
        type: "directory_not_empty",
        path: testDir,
        description: "Directory should not be empty",
      };

      expect(await engine.evaluate(assertion)).toBe(true);
    });

    it("returns false when directory is empty", async () => {
      const emptyDir = path.join(testDir, "empty");
      await fs.mkdir(emptyDir);

      const assertion: Assertion = {
        type: "directory_not_empty",
        path: emptyDir,
        description: "Directory should not be empty",
      };

      expect(await engine.evaluate(assertion)).toBe(false);
    });
  });

  describe("all_of", () => {
    it("returns true when all conditions pass", async () => {
      await fs.writeFile(path.join(testDir, "a.txt"), "a");
      await fs.writeFile(path.join(testDir, "b.txt"), "b");

      const assertion: Assertion = {
        type: "all_of",
        conditions: [
          { type: "file_exists", path: path.join(testDir, "a.txt"), description: "a exists" },
          { type: "file_exists", path: path.join(testDir, "b.txt"), description: "b exists" },
        ],
        description: "All files should exist",
      };

      expect(await engine.evaluate(assertion)).toBe(true);
    });

    it("returns false when any condition fails", async () => {
      await fs.writeFile(path.join(testDir, "a.txt"), "a");

      const assertion: Assertion = {
        type: "all_of",
        conditions: [
          { type: "file_exists", path: path.join(testDir, "a.txt"), description: "a exists" },
          {
            type: "file_exists",
            path: path.join(testDir, "nonexistent.txt"),
            description: "nonexistent exists",
          },
        ],
        description: "All files should exist",
      };

      expect(await engine.evaluate(assertion)).toBe(false);
    });
  });

  describe("any_of", () => {
    it("returns true when any condition passes", async () => {
      await fs.writeFile(path.join(testDir, "a.txt"), "a");

      const assertion: Assertion = {
        type: "any_of",
        conditions: [
          { type: "file_exists", path: path.join(testDir, "a.txt"), description: "a exists" },
          {
            type: "file_exists",
            path: path.join(testDir, "nonexistent.txt"),
            description: "nonexistent exists",
          },
        ],
        description: "Any file should exist",
      };

      expect(await engine.evaluate(assertion)).toBe(true);
    });

    it("returns false when all conditions fail", async () => {
      const assertion: Assertion = {
        type: "any_of",
        conditions: [
          { type: "file_exists", path: path.join(testDir, "a.txt"), description: "a exists" },
          { type: "file_exists", path: path.join(testDir, "b.txt"), description: "b exists" },
        ],
        description: "Any file should exist",
      };

      expect(await engine.evaluate(assertion)).toBe(false);
    });
  });
});
