/**
 * TaskGraph Configuration Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getTaskGraphConfig", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns defaults when no taskgraph config set", async () => {
    // Mock loadConfig to return empty config
    vi.doMock("../config/config.js", () => ({
      loadConfig: () => ({}),
    }));

    const { getTaskGraphConfig } = await import("./config.js");
    const config = getTaskGraphConfig();

    expect(config.enabled).toBe(true);
    expect(config.checkpoints.enabled).toBe(true);
    expect(config.checkpoints.intervalSteps).toBe(5);
    expect(config.checkpoints.storageDir).toBe("~/.openclaw/taskgraphs/checkpoints");
    expect(config.limits.maxSteps).toBe(50);
    expect(config.limits.maxRetries).toBe(3);
    expect(config.limits.maxReplans).toBe(2);
    expect(config.limits.stepTimeoutMs).toBe(120_000);
  });

  it("returns custom config when taskgraph is set", async () => {
    vi.doMock("../config/config.js", () => ({
      loadConfig: () => ({
        taskgraph: {
          enabled: false,
          checkpoints: {
            enabled: false,
            intervalSteps: 10,
            storageDir: "/custom/path",
          },
          limits: {
            maxSteps: 100,
            maxRetries: 5,
            maxReplans: 3,
            stepTimeoutMs: 300_000,
          },
        },
      }),
    }));

    const { getTaskGraphConfig } = await import("./config.js");
    const config = getTaskGraphConfig();

    expect(config.enabled).toBe(false);
    expect(config.checkpoints.enabled).toBe(false);
    expect(config.checkpoints.intervalSteps).toBe(10);
    expect(config.checkpoints.storageDir).toBe("/custom/path");
    expect(config.limits.maxSteps).toBe(100);
    expect(config.limits.maxRetries).toBe(5);
    expect(config.limits.maxReplans).toBe(3);
    expect(config.limits.stepTimeoutMs).toBe(300_000);
  });

  it("merges partial config with defaults", async () => {
    vi.doMock("../config/config.js", () => ({
      loadConfig: () => ({
        taskgraph: {
          enabled: false,
          limits: {
            maxSteps: 75,
          },
        },
      }),
    }));

    const { getTaskGraphConfig } = await import("./config.js");
    const config = getTaskGraphConfig();

    expect(config.enabled).toBe(false);
    expect(config.checkpoints).toBeDefined();
    expect(config.checkpoints.enabled).toBe(true); // default
    expect(config.checkpoints.intervalSteps).toBe(5); // default
    expect(config.limits).toBeDefined();
    expect(config.limits.maxSteps).toBe(75); // custom
    expect(config.limits.maxRetries).toBe(3); // default
    expect(config.limits.maxReplans).toBe(2); // default
    expect(config.limits.stepTimeoutMs).toBe(120_000); // default
  });
});
