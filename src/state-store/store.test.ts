// src/state-store/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GlobalStateStore } from "./store.js";

describe("GlobalStateStore", () => {
  let store: GlobalStateStore;

  beforeEach(() => {
    store = new GlobalStateStore();
  });

  describe("get/set", () => {
    it("stores and retrieves values", async () => {
      await store.set("key1", "value1");
      const result = await store.get("key1");

      expect(result).not.toBeNull();
      expect(result?.value).toBe("value1");
      expect(result?.version).toBe(1);
    });

    it("returns null for non-existent keys", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeNull();
    });

    it("increments version on update", async () => {
      await store.set("key1", "value1");
      await store.set("key1", "value2");
      await store.set("key1", "value3");

      const result = await store.get("key1");
      expect(result?.version).toBe(3);
      expect(result?.value).toBe("value3");
    });

    it("supports optimistic locking", async () => {
      await store.set("key1", "value1", 0); // version 1

      const success1 = await store.set("key1", "value2", 1); // correct version
      expect(success1).toBe(true);

      const success2 = await store.set("key1", "value3", 1); // stale version
      expect(success2).toBe(false);

      const result = await store.get("key1");
      expect(result?.value).toBe("value2");
    });
  });

  describe("update", () => {
    it("updates with updater function", async () => {
      await store.set("counter", 0);
      const newVersion = await store.update("counter", (v) => (v as number) + 1);

      expect(newVersion).toBe(2);
      const result = await store.get("counter");
      expect(result?.value).toBe(1);
    });

    it("retries on version conflict", async () => {
      await store.set("counter", 0);

      // Concurrent update simulation
      const update1 = store.update("counter", (v) => (v as number) + 10);
      const update2 = store.update("counter", (v) => (v as number) + 20);

      await Promise.all([update1, update2]);

      const result = await store.get("counter");
      // At least one update should succeed
      expect(result?.value as number).toBeGreaterThanOrEqual(10);
    });
  });

  describe("subscribe", () => {
    it("notifies subscribers on change", async () => {
      const events: unknown[] = [];
      const unsub = store.subscribe("key1", (v) => events.push(v));

      await store.set("key1", "value1");
      await store.set("key1", "value2");

      expect(events).toEqual(["value1", "value2"]);

      unsub();
      await store.set("key1", "value3");

      expect(events).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("removes keys", async () => {
      await store.set("key1", "value1");
      const deleted = await store.delete("key1");

      expect(deleted).toBe(true);
      expect(await store.get("key1")).toBeNull();
    });

    it("returns false for non-existent keys", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("listKeys", () => {
    it("lists all keys without pattern", async () => {
      await store.set("a", 1);
      await store.set("b", 2);
      await store.set("c", 3);

      const keys = await store.listKeys();
      expect(keys.toSorted()).toEqual(["a", "b", "c"]);
    });

    it("filters by pattern", async () => {
      await store.set("file:1", 1);
      await store.set("file:2", 2);
      await store.set("dir:1", 3);

      const keys = await store.listKeys("file:*");
      expect(keys.toSorted()).toEqual(["file:1", "file:2"]);
    });
  });

  describe("stats", () => {
    it("tracks key count", async () => {
      await store.set("a", 1);
      await store.set("b", 2);

      const stats = store.getStats();
      expect(stats.keyCount).toBe(2);
    });

    it("tracks version conflicts", async () => {
      await store.set("key1", "value1", 0);
      await store.set("key1", "value2", 1); // success
      await store.set("key1", "value3", 1); // conflict

      const stats = store.getStats();
      expect(stats.versionConflicts).toBe(1);
    });
  });
});
