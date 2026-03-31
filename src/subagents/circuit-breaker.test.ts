// src/subagents/circuit-breaker.test.ts
import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  describe("initial state", () => {
    it("starts in closed state", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe("closed");
    });

    it("allows requests in closed state", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.isAllowed()).toBe(true);
    });
  });

  describe("closed state", () => {
    it("executes function and returns result", async () => {
      const breaker = new CircuitBreaker();
      const result = await breaker.execute(() => Promise.resolve("success"));

      expect(result).toBe("success");
    });

    it("tracks failures", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(2);
      expect(stats.state).toBe("closed");
    });

    it("opens after failure threshold reached", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      expect(breaker.getState()).toBe("open");
    });

    it("resets failure count on success", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });

      // Cause 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      expect(breaker.getStats().failureCount).toBe(3);

      // Succeed
      await breaker.execute(() => Promise.resolve("success"));

      expect(breaker.getStats().failureCount).toBe(0);
      expect(breaker.getState()).toBe("closed");
    });
  });

  describe("open state", () => {
    it("rejects requests immediately", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 });

      // Trigger open state
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      expect(breaker.getState()).toBe("open");
      expect(breaker.isAllowed()).toBe(false);

      await expect(breaker.execute(() => Promise.resolve("success"))).rejects.toThrow(
        CircuitOpenError,
      );
    });

    it("transitions to half-open after reset timeout", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

      // Trigger open state
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      expect(breaker.getState()).toBe("open");

      // Wait for reset timeout
      await new Promise((r) => setTimeout(r, 100));

      // Should allow request (half-open)
      expect(breaker.isAllowed()).toBe(true);
    });
  });

  describe("half-open state", () => {
    it("closes after success threshold", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 10,
        successThreshold: 2,
      });

      // Trigger open state
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      // Wait for reset
      await new Promise((r) => setTimeout(r, 20));

      // Succeed twice
      await breaker.execute(() => Promise.resolve("success"));
      await breaker.execute(() => Promise.resolve("success"));

      expect(breaker.getState()).toBe("closed");
    });

    it("reopens on failure", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 10,
        successThreshold: 3,
      });

      // Trigger open state
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      // Wait for reset
      await new Promise((r) => setTimeout(r, 20));

      // Succeed once (half-open)
      await breaker.execute(() => Promise.resolve("success"));

      // Then fail
      try {
        await breaker.execute(() => Promise.reject(new Error("fail")));
      } catch {}

      expect(breaker.getState()).toBe("open");
    });
  });

  describe("statistics", () => {
    it("tracks total calls, failures, and successes", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 10 });

      await breaker.execute(() => Promise.resolve("success"));
      await breaker.execute(() => Promise.resolve("success"));

      try {
        await breaker.execute(() => Promise.reject(new Error("fail")));
      } catch {}

      const stats = breaker.getStats();

      expect(stats.totalCalls).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
    });

    it("tracks last failure and success times", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 10 });

      const beforeSuccess = Date.now();
      await breaker.execute(() => Promise.resolve("success"));

      const beforeFailure = Date.now();
      try {
        await breaker.execute(() => Promise.reject(new Error("fail")));
      } catch {}

      const stats = breaker.getStats();

      expect(stats.lastSuccessTime).toBeGreaterThanOrEqual(beforeSuccess);
      expect(stats.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
    });
  });

  describe("manual control", () => {
    it("trip() forces open state", () => {
      const breaker = new CircuitBreaker();
      breaker.trip();

      expect(breaker.getState()).toBe("open");
    });

    it("reset() forces closed state", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });

      // Trigger open
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {}
      }

      expect(breaker.getState()).toBe("open");

      breaker.reset();

      expect(breaker.getState()).toBe("closed");
      expect(breaker.isAllowed()).toBe(true);
    });
  });
});
