// src/subagents/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyError,
  isRetryable,
  getRetryDelay,
  createSubAgentError,
  SubAgentErrorClass,
} from "./errors.js";
import type { SubAgentErrorType } from "./types.js";

describe("Error Classification", () => {
  describe("classifyError", () => {
    it("classifies ENOENT as resource_not_found", () => {
      const error = new Error("ENOENT: no such file or directory");
      expect(classifyError(error)).toBe("resource_not_found");
    });

    it("classifies 'not found' as resource_not_found", () => {
      const error = new Error("File not found: /tmp/test.txt");
      expect(classifyError(error)).toBe("resource_not_found");
    });

    it("classifies 'permission denied' as permission_denied", () => {
      const error = new Error("Permission denied: /etc/passwd");
      expect(classifyError(error)).toBe("permission_denied");
    });

    it("classifies EACCES as permission_denied", () => {
      const error = new Error("EACCES: permission denied");
      expect(classifyError(error)).toBe("permission_denied");
    });

    it("classifies timeout errors", () => {
      const error = new Error("Operation timed out after 30s");
      expect(classifyError(error)).toBe("timeout");
    });

    it("classifies ETIMEDOUT as timeout", () => {
      const error = new Error("ETIMEDOUT: connection timed out");
      expect(classifyError(error)).toBe("timeout");
    });

    it("classifies security blocked errors", () => {
      const error = new Error("Security blocked: path not allowed");
      expect(classifyError(error)).toBe("security_blocked");
    });

    it("classifies network errors", () => {
      const errors = [
        new Error("ECONNREFUSED: connection refused"),
        new Error("ECONNRESET: connection reset by peer"),
        new Error("ENOTFOUND: host not found"),
        new Error("Network error: failed to fetch"),
      ];

      for (const error of errors) {
        expect(classifyError(error)).toBe("network_error");
      }
    });

    it("classifies rate limit errors", () => {
      const error = new Error("Rate limit exceeded (429)");
      expect(classifyError(error)).toBe("rate_limited");
    });

    it("classifies invalid input errors", () => {
      const error = new Error("Invalid argument: malformed JSON");
      expect(classifyError(error)).toBe("invalid_input");
    });

    it("returns unknown for unclassifiable errors", () => {
      const error = new Error("Something weird happened");
      expect(classifyError(error)).toBe("unknown");
    });

    it("handles non-Error inputs", () => {
      expect(classifyError("string error")).toBe("unknown");
      expect(classifyError(null)).toBe("unknown");
      expect(classifyError(undefined)).toBe("unknown");
    });

    it("extracts type from SubAgentErrorClass", () => {
      const error = new SubAgentErrorClass("permission_denied", "No access");
      expect(classifyError(error)).toBe("permission_denied");
    });
  });

  describe("isRetryable", () => {
    it("returns true for retryable errors", () => {
      const retryableTypes: SubAgentErrorType[] = [
        "timeout",
        "network_error",
        "rate_limited",
        "unknown",
      ];

      for (const type of retryableTypes) {
        expect(isRetryable(type)).toBe(true);
      }
    });

    it("returns false for non-retryable errors", () => {
      const nonRetryableTypes: SubAgentErrorType[] = [
        "resource_not_found",
        "permission_denied",
        "security_blocked",
        "invalid_input",
      ];

      for (const type of nonRetryableTypes) {
        expect(isRetryable(type)).toBe(false);
      }
    });
  });

  describe("getRetryDelay", () => {
    it("returns 0 for non-retryable errors", () => {
      expect(getRetryDelay("permission_denied", 1)).toBe(0);
      expect(getRetryDelay("resource_not_found", 1)).toBe(0);
      expect(getRetryDelay("security_blocked", 1)).toBe(0);
    });

    it("increases delay with exponential backoff", () => {
      const delay1 = getRetryDelay("network_error", 1);
      const delay2 = getRetryDelay("network_error", 2);
      const delay3 = getRetryDelay("network_error", 3);

      // Should increase (approximately, allowing for jitter)
      // delay1 ~ 1000 + jitter
      // delay2 ~ 2000 + jitter
      // delay3 ~ 4000 + jitter
      expect(delay1).toBeGreaterThan(500);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it("caps delay at 30 seconds", () => {
      const delay = getRetryDelay("rate_limited", 10);
      expect(delay).toBeLessThanOrEqual(30000);
    });

    it("uses longer delay for rate_limited", () => {
      const rateLimitDelay = getRetryDelay("rate_limited", 1);
      const timeoutDelay = getRetryDelay("timeout", 1);
      expect(rateLimitDelay).toBeGreaterThan(timeoutDelay);
    });
  });

  describe("createSubAgentError", () => {
    it("creates error from Error object", () => {
      const error = new Error("Test error");
      const result = createSubAgentError(error, { stepId: "step-1" });

      expect(result.message).toBe("Test error");
      expect(result.type).toBe("unknown");
      expect(result.retryable).toBe(true);
      expect(result.context).toEqual({ stepId: "step-1" });
    });

    it("creates error from string", () => {
      const result = createSubAgentError("Something failed");

      expect(result.message).toBe("Something failed");
      expect(result.type).toBe("unknown");
    });

    it("handles null/undefined", () => {
      const result1 = createSubAgentError(null);
      const result2 = createSubAgentError(undefined);

      expect(result1.type).toBe("unknown");
      expect(result2.type).toBe("unknown");
    });
  });

  describe("SubAgentErrorClass", () => {
    it("creates classified error", () => {
      const error = new SubAgentErrorClass("timeout", "Operation timed out");

      expect(error.type).toBe("timeout");
      expect(error.message).toBe("Operation timed out");
      expect(error.retryable).toBe(true);
      expect(error.name).toBe("SubAgentError");
    });

    it("preserves cause", () => {
      const cause = new Error("Original error");
      const error = new SubAgentErrorClass("execution_error", "Wrapped", { cause });

      expect(error.cause).toBe(cause);
    });

    it("serializes to JSON", () => {
      const error = new SubAgentErrorClass("permission_denied", "No access", {
        context: { path: "/etc/passwd" },
      });

      const json = error.toJSON();

      expect(json.type).toBe("permission_denied");
      expect(json.message).toBe("No access");
      expect(json.retryable).toBe(false);
      expect(json.context).toEqual({ path: "/etc/passwd" });
    });
  });
});
