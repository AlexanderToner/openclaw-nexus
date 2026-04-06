import { describe, it, expect } from "vitest";
import { SSRFGuard, defaultSSRFGuard } from "./ssrf-guard.js";

describe("SSRFGuard", () => {
  const guard = new SSRFGuard();

  it("blocks loopback IPs", () => {
    expect(guard.isBlocked("127.0.0.1")).toBe(true);
    expect(guard.isBlocked("127.0.0.2")).toBe(true);
    expect(guard.isBlocked("127.255.255.255")).toBe(true);
  });

  it("blocks AWS/GCP/Azure metadata endpoint", () => {
    expect(guard.isBlocked("169.254.169.254")).toBe(true);
    expect(guard.isBlocked("metadata.google.internal")).toBe(true);
    expect(guard.isBlocked("metadata.googleusercontent.com")).toBe(true);
    expect(guard.isBlocked("metadata.internal")).toBe(true);
  });

  it("blocks private IP ranges", () => {
    // Class A private (10.x.x.x)
    expect(guard.isBlocked("10.0.0.1")).toBe(true);
    expect(guard.isBlocked("10.255.255.255")).toBe(true);
    // Class B private (172.16-31.x.x)
    expect(guard.isBlocked("172.16.0.1")).toBe(true);
    expect(guard.isBlocked("172.31.255.255")).toBe(true);
    expect(guard.isBlocked("172.20.0.1")).toBe(true);
    // Class C private (192.168.x.x)
    expect(guard.isBlocked("192.168.0.1")).toBe(true);
    expect(guard.isBlocked("192.168.1.1")).toBe(true);
    expect(guard.isBlocked("192.168.255.255")).toBe(true);
  });

  it("blocks link-local and other reserved ranges", () => {
    expect(guard.isBlocked("169.254.0.1")).toBe(true);
    expect(guard.isBlocked("0.0.0.0")).toBe(true);
    expect(guard.isBlocked("224.0.0.1")).toBe(true);
    expect(guard.isBlocked("240.0.0.1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(guard.isBlocked("8.8.8.8")).toBe(false);
    expect(guard.isBlocked("1.1.1.1")).toBe(false);
    expect(guard.isBlocked("203.0.113.1")).toBe(false);
  });

  it("allows public hostnames", () => {
    expect(guard.isBlocked("api.openai.com")).toBe(false);
    expect(guard.isBlocked("api.anthropic.com")).toBe(false);
    expect(guard.isBlocked("localhost")).toBe(false);
    expect(guard.isBlocked("ollama.local")).toBe(false);
  });

  it("allows subdomain variants of blocked hosts when metadata is allowed", () => {
    // With default guard, subdomains of metadata endpoints are also blocked
    const guard = new SSRFGuard({ allowMetadata: true });
    expect(guard.isBlocked("169.254.169.254")).toBe(false);
  });

  it("assertSafe throws on blocked hosts", () => {
    expect(() => guard.assertSafe("127.0.0.1")).toThrow("SSRF guard blocked");
    expect(() => guard.assertSafe("169.254.169.254")).toThrow("SSRF guard blocked");
    expect(() => guard.assertSafe("10.0.0.1")).toThrow("SSRF guard blocked");
  });

  it("assertSafe does not throw on allowed hosts", () => {
    expect(() => guard.assertSafe("8.8.8.8")).not.toThrow();
    expect(() => guard.assertSafe("api.openai.com")).not.toThrow();
    expect(() => guard.assertSafe("localhost")).not.toThrow();
  });

  it("allowInternal allows private IPs but still blocks metadata endpoints", () => {
    const guard = new SSRFGuard({ allowInternal: true });
    expect(guard.isBlocked("10.0.0.1")).toBe(false);
    expect(guard.isBlocked("172.16.0.1")).toBe(false);
    expect(guard.isBlocked("192.168.1.1")).toBe(false);
    expect(guard.isBlocked("127.0.0.1")).toBe(false);
    // Metadata endpoints still blocked unless allowMetadata is also set
    expect(guard.isBlocked("169.254.169.254")).toBe(true);
  });

  it("allowMetadata allows cloud metadata endpoints", () => {
    const guard = new SSRFGuard({ allowMetadata: true });
    expect(guard.isBlocked("169.254.169.254")).toBe(false);
    expect(guard.isBlocked("metadata.google.internal")).toBe(false);
    expect(guard.isBlocked("metadata.googleusercontent.com")).toBe(false);
  });

  it("both allowInternal and allowMetadata combined", () => {
    const guard = new SSRFGuard({ allowInternal: true, allowMetadata: true });
    expect(guard.isBlocked("10.0.0.1")).toBe(false);
    expect(guard.isBlocked("169.254.169.254")).toBe(false);
    expect(guard.isBlocked("8.8.8.8")).toBe(false);
  });

  it("is case-insensitive for hostname matching", () => {
    expect(guard.isBlocked("METADATA.GOOGLE.INTERNAL")).toBe(true);
    expect(guard.isBlocked("Metadata.Google.Internal")).toBe(true);
  });

  it("defaultSSRFGuard is properly configured", () => {
    expect(defaultSSRFGuard.isBlocked("127.0.0.1")).toBe(true);
    expect(defaultSSRFGuard.isBlocked("8.8.8.8")).toBe(false);
  });
});
