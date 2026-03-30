// src/state-store/merge-strategies.test.ts
import { describe, it, expect } from "vitest";
import { applyMergeStrategy } from "./merge-strategies.js";

describe("Merge Strategies", () => {
  describe("overwrite", () => {
    it("replaces current value with new value", () => {
      expect(applyMergeStrategy("overwrite", "old", "new")).toBe("new");
    });

    it("works with objects", () => {
      const oldObj = { a: 1, b: 2 };
      const newObj = { c: 3 };
      expect(applyMergeStrategy("overwrite", oldObj, newObj)).toEqual({ c: 3 });
    });
  });

  describe("append", () => {
    it("concatenates arrays", () => {
      expect(applyMergeStrategy("append", ["a", "b"], ["c"])).toEqual(["a", "b", "c"]);
    });

    it("returns new array if current is not an array", () => {
      expect(applyMergeStrategy("append", "not-array", ["a"])).toEqual(["a"]);
    });

    it("returns current if new value is not an array", () => {
      expect(applyMergeStrategy("append", ["a"], "not-array")).toEqual(["a"]);
    });
  });

  describe("union", () => {
    it("merges sets", () => {
      const result = applyMergeStrategy("union", new Set(["a"]), new Set(["b"]));
      expect(result).toEqual(new Set(["a", "b"]));
    });

    it("merges arrays as sets", () => {
      const result = applyMergeStrategy("union", ["a", "b"], ["b", "c"]);
      expect(result).toEqual(new Set(["a", "b", "c"]));
    });

    it("handles empty values", () => {
      expect(applyMergeStrategy("union", new Set(["a"]), null)).toEqual(new Set(["a"]));
      expect(applyMergeStrategy("union", null, new Set(["a"]))).toEqual(new Set(["a"]));
    });
  });

  describe("merge", () => {
    it("deep merges objects", () => {
      const oldObj = { a: 1, b: { c: 2 } };
      const newObj = { b: { d: 3 }, e: 4 };
      const result = applyMergeStrategy("merge", oldObj, newObj);

      expect(result).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
    });

    it("handles null values", () => {
      expect(applyMergeStrategy("merge", null, { a: 1 })).toEqual({ a: 1 });
      expect(applyMergeStrategy("merge", { a: 1 }, null)).toEqual({ a: 1 });
    });
  });

  describe("default", () => {
    it("returns new value for unknown strategy", () => {
      expect(applyMergeStrategy("unknown" as never, "old", "new")).toBe("new");
    });
  });
});
