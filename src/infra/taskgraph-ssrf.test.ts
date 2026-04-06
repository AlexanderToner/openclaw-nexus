import { describe, it, expect } from "vitest";
import { SSRFGuard, defaultSSRFGuard } from "../taskgraph/ssrf-guard.js";

describe("TaskGraph SSRF integration", () => {
  describe("defaultSSRFGuard singleton", () => {
    it("isBlocked returns true for private IPs", () => {
      expect(defaultSSRFGuard.isBlocked("127.0.0.1")).toBe(true);
      expect(defaultSSRFGuard.isBlocked("10.0.0.5")).toBe(true);
    });

    it("isBlocked returns false for public IPs", () => {
      expect(defaultSSRFGuard.isBlocked("8.8.8.8")).toBe(false);
      expect(defaultSSRFGuard.isBlocked("1.1.1.1")).toBe(false);
    });

    it("assertSafe throws on blocked hosts", () => {
      expect(() => defaultSSRFGuard.assertSafe("127.0.0.1")).toThrow("SSRF guard blocked");
      expect(() => defaultSSRFGuard.assertSafe("8.8.8.8")).not.toThrow();
    });
  });

  describe("SSRFGuard blocks dangerous targets", () => {
    const guard = new SSRFGuard();

    it.each([
      ["127.0.0.1"],
      ["127.0.0.2:8080"],
      ["10.0.0.5"],
      ["10.255.255.1"],
      ["172.16.0.1"],
      ["172.31.255.1"],
      ["192.168.1.100"],
      ["192.168.0.1"],
      ["169.254.169.254"],
      ["169.254.0.1"],
      ["0.0.0.0"],
      ["metadata.google.internal"],
      ["metadata.googleusercontent.com"],
      ["metadata.internal"],
    ])("blocks $0", (target) => {
      expect(guard.isBlocked(target)).toBe(true);
    });

    it.each([["224.0.0.1"], ["240.0.0.1"]])("blocks reserved/multicast IP $0", (target) => {
      expect(guard.isBlocked(target)).toBe(true);
    });

    it.each([
      ["api.anthropic.com"],
      ["api.openai.com"],
      ["8.8.8.8"],
      ["1.1.1.1"],
      ["github.com"],
      ["api.groq.com"],
      ["api.minimax.io"],
    ])("allows $0", (target) => {
      expect(guard.isBlocked(target)).toBe(false);
    });

    it("assertSafe throws on blocked hosts", () => {
      expect(() => guard.assertSafe("127.0.0.1")).toThrow("SSRF guard blocked");
      expect(() => guard.assertSafe("8.8.8.8")).not.toThrow();
    });

    it("allowInternal allows private IPs", () => {
      const guard = new SSRFGuard({ allowInternal: true });
      expect(guard.isBlocked("10.0.0.1")).toBe(false);
      expect(guard.isBlocked("169.254.169.254")).toBe(true); // metadata still blocked
    });

    it("allowMetadata allows metadata endpoints", () => {
      const guard = new SSRFGuard({ allowMetadata: true });
      expect(guard.isBlocked("169.254.169.254")).toBe(false);
      expect(guard.isBlocked("metadata.google.internal")).toBe(false);
    });

    it("allowInternal and allowMetadata together", () => {
      const guard = new SSRFGuard({ allowInternal: true, allowMetadata: true });
      expect(guard.isBlocked("10.0.0.1")).toBe(false);
      expect(guard.isBlocked("169.254.169.254")).toBe(false);
      expect(guard.isBlocked("api.anthropic.com")).toBe(false);
    });
  });
});
