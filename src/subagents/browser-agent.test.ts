// src/subagents/browser-agent.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Step, BrowserAction } from "../taskgraph/types.js";
import { BrowserAgent } from "./browser-agent.js";
import type { SubAgentContext } from "./types.js";

describe("BrowserAgent", () => {
  let agent: BrowserAgent;
  let context: SubAgentContext;

  beforeEach(() => {
    agent = new BrowserAgent();
    context = {
      taskId: "test-task",
      workingDir: "/tmp",
      timeoutMs: 5000,
      state: new Map<string, unknown>(),
      env: {},
    };
  });

  describe("canHandle", () => {
    it("returns true for browser steps", () => {
      const step = createStep("s1", { action: "navigate", url: "https://example.com" });
      expect(agent.canHandle(step)).toBe(true);
    });

    it("returns false for non-browser steps", () => {
      const step = {
        ...createStep("s1", { action: "navigate", url: "https://example.com" }),
        type: "file" as const,
      };
      expect(agent.canHandle(step)).toBe(false);
    });
  });

  describe("navigate action", () => {
    it("executes navigate with valid URL", async () => {
      const step = createStep("s1", { action: "navigate", url: "https://example.com" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "navigate",
        url: "https://example.com",
        success: true,
      });
    });

    it("fails without URL", async () => {
      const step = createStep("s1", { action: "navigate" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("URL is required");
    });

    it("fails with invalid URL", async () => {
      const step = createStep("s1", { action: "navigate", url: "not-a-valid-url" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Invalid URL");
    });
  });

  describe("click action", () => {
    it("executes click with selector", async () => {
      const step = createStep("s1", { action: "click", selector: "#submit-button" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "click",
        selector: "#submit-button",
        success: true,
      });
    });

    it("fails without selector", async () => {
      const step = createStep("s1", { action: "click" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Selector is required");
    });
  });

  describe("type action", () => {
    it("executes type with selector and payload", async () => {
      const step = createStep("s1", {
        action: "type",
        selector: "#search-input",
        payload: "search query",
      });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "type",
        selector: "#search-input",
        success: true,
      });
    });

    it("fails without selector", async () => {
      const step = createStep("s1", { action: "type", payload: "text" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Selector and payload are required");
    });

    it("fails without payload", async () => {
      const step = createStep("s1", { action: "type", selector: "#input" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Selector and payload are required");
    });
  });

  describe("extract action", () => {
    it("executes extract with selector", async () => {
      const step = createStep("s1", { action: "extract", selector: ".product-title" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "extract",
        selector: ".product-title",
        success: true,
      });
    });

    it("fails without selector", async () => {
      const step = createStep("s1", { action: "extract" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Selector is required");
    });
  });

  describe("screenshot action", () => {
    it("executes screenshot", async () => {
      const step = createStep("s1", { action: "screenshot" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "screenshot",
        success: true,
      });
    });
  });

  describe("wait action", () => {
    it("executes wait with selector", async () => {
      const step = createStep("s1", { action: "wait", selector: ".loaded-content" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "wait",
        selector: ".loaded-content",
        success: true,
      });
    });

    it("executes wait with timeout", async () => {
      const step = createStep("s1", { action: "wait", timeoutMs: 3000 });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.output).toMatchObject({
        action: "wait",
        success: true,
      });
    });
  });

  describe("security", () => {
    it("blocks URL with non-whitelisted domain", async () => {
      context.securityArbiter = new MockSecurityArbiter(["allowed.com"]);

      const step = createStep("s1", {
        action: "navigate",
        url: "https://blocked.com",
      });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("failed");
      expect(result.error?.type).toBe("security_blocked");
    });

    it("allows URL with whitelisted domain", async () => {
      context.securityArbiter = new MockSecurityArbiter(["example.com"]);

      const step = createStep("s1", {
        action: "navigate",
        url: "https://example.com",
      });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
    });

    it("allows all URLs without security arbiter", async () => {
      const step = createStep("s1", {
        action: "navigate",
        url: "https://any-domain.com",
      });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
    });
  });

  describe("metadata", () => {
    it("includes duration in result", async () => {
      const step = createStep("s1", { action: "navigate", url: "https://example.com" });
      const result = await agent.execute(step, context);

      expect(result.status).toBe("success");
      expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

/**
 * Mock security arbiter for testing.
 */
class MockSecurityArbiter {
  private allowedDomains: Set<string>;

  constructor(allowedDomains: string[] = []) {
    this.allowedDomains = new Set(allowedDomains);
  }

  checkDomain(domain: string): { allowed: boolean; reason?: string } {
    const allowed = this.allowedDomains.has(domain);
    return {
      allowed,
      reason: allowed ? undefined : `Domain '${domain}' not in whitelist`,
    };
  }

  checkCommand(_command: string): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }

  checkPath(_path: string): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }

  checkPort(_port: number): { allowed: boolean; reason?: string } {
    return { allowed: true };
  }
}

function createStep(id: string, action: Partial<BrowserAction>): Step {
  return {
    id,
    type: "browser",
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action: {
      action: action.action ?? "navigate",
      url: action.url,
      selector: action.selector,
      payload: action.payload,
      timeoutMs: action.timeoutMs,
    },
  } as Step;
}
