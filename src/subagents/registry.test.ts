// src/subagents/registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Step } from "../taskgraph/types.js";
import { SubAgentRegistry } from "./registry.js";
import type { SubAgent, SubAgentType, SubAgentResult, ValidationResult } from "./types.js";

describe("SubAgentRegistry", () => {
  let registry: SubAgentRegistry;

  beforeEach(() => {
    registry = new SubAgentRegistry();
  });

  describe("register", () => {
    it("registers an agent", () => {
      const agent = createMockAgent("file");
      registry.register(agent);

      expect(registry.hasType("file")).toBe(true);
    });

    it("registers multiple agents of same type", () => {
      const agent1 = createMockAgent("file", "file-agent-1");
      const agent2 = createMockAgent("file", "file-agent-2");

      registry.register(agent1);
      registry.register(agent2);

      const agents = registry.getAgentsByType("file");
      expect(agents).toHaveLength(2);
    });

    it("sorts agents by priority", () => {
      const agent1 = createMockAgent("file", "low-priority");
      const agent2 = createMockAgent("file", "high-priority");

      registry.register(agent1, { priority: 10 });
      registry.register(agent2, { priority: 100 });

      const agents = registry.getAgentsByType("file");
      expect(agents[0].name).toBe("high-priority");
      expect(agents[1].name).toBe("low-priority");
    });
  });

  describe("unregister", () => {
    it("unregisters an agent", () => {
      const agent = createMockAgent("file");
      registry.register(agent);

      const result = registry.unregister(agent);

      expect(result).toBe(true);
      expect(registry.hasType("file")).toBe(false);
    });

    it("returns false for unregistered agent", () => {
      const agent = createMockAgent("file");
      const result = registry.unregister(agent);

      expect(result).toBe(false);
    });
  });

  describe("getAgent", () => {
    it("returns agent for matching step", () => {
      const agent = createMockAgent("file", undefined, true);
      registry.register(agent);

      const step = createStep("step-1", "file");
      const found = registry.getAgent(step);

      expect(found).toBe(agent);
    });

    it("returns null for unregistered type", () => {
      const step = createStep("step-1", "browser");
      const found = registry.getAgent(step);

      expect(found).toBeNull();
    });

    it("returns first agent that can handle step", () => {
      const agent1 = createMockAgent("file", "cannot-handle", false);
      const agent2 = createMockAgent("file", "can-handle", true);

      registry.register(agent1);
      registry.register(agent2);

      const step = createStep("step-1", "file");
      const found = registry.getAgent(step);

      expect(found?.name).toBe("can-handle");
    });

    it("falls back to first agent if none can handle", () => {
      const agent1 = createMockAgent("file", "first", false);
      const agent2 = createMockAgent("file", "second", false);

      registry.register(agent1);
      registry.register(agent2);

      const step = createStep("step-1", "file");
      const found = registry.getAgent(step);

      // Falls back to first (highest priority)
      expect(found?.name).toBe("first");
    });
  });

  describe("getAgentsByType", () => {
    it("returns empty array for unregistered type", () => {
      const agents = registry.getAgentsByType("gui");
      expect(agents).toEqual([]);
    });

    it("returns all agents of type", () => {
      const agent1 = createMockAgent("shell", "shell-1");
      const agent2 = createMockAgent("shell", "shell-2");

      registry.register(agent1);
      registry.register(agent2);

      const agents = registry.getAgentsByType("shell");
      expect(agents).toHaveLength(2);
    });
  });

  describe("getAllAgents", () => {
    it("returns all registered agents", () => {
      registry.register(createMockAgent("file"));
      registry.register(createMockAgent("shell"));
      registry.register(createMockAgent("browser"));

      const all = registry.getAllAgents();
      expect(all).toHaveLength(3);
    });

    it("returns empty array when no agents registered", () => {
      expect(registry.getAllAgents()).toEqual([]);
    });
  });

  describe("validateStep", () => {
    it("returns invalid when no agent registered", () => {
      const step = createStep("step-1", "gui");
      const result = registry.validateStep(step);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("No agent registered for step type: gui");
    });

    it("uses agent validation", () => {
      const agent = createMockAgentWithValidation("file", {
        valid: false,
        errors: ["Invalid path"],
      });
      registry.register(agent);

      const step = createStep("step-1", "file");
      const result = registry.validateStep(step);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid path");
    });

    it("returns valid when agent has no validator", () => {
      const agent = createMockAgent("file");
      registry.register(agent);

      const step = createStep("step-1", "file");
      const result = registry.validateStep(step);

      expect(result.valid).toBe(true);
    });
  });

  describe("clear", () => {
    it("clears all agents", () => {
      registry.register(createMockAgent("file"));
      registry.register(createMockAgent("shell"));

      registry.clear();

      expect(registry.getAllAgents()).toEqual([]);
    });
  });

  describe("getStats", () => {
    it("returns registry statistics", () => {
      registry.register(createMockAgent("file", "file-1"));
      registry.register(createMockAgent("file", "file-2"));
      registry.register(createMockAgent("shell", "shell-1"));

      const stats = registry.getStats();

      expect(stats.totalAgents).toBe(3);
      expect(stats.byType["file"]).toBe(2);
      expect(stats.byType["shell"]).toBe(1);
    });
  });
});

function createMockAgent(type: SubAgentType, name = `mock-${type}`, canHandle = true): SubAgent {
  return {
    type,
    name,
    description: `Mock ${type} agent`,
    canHandle: () => canHandle,
    execute: async (): Promise<SubAgentResult> => ({
      stepId: "test",
      status: "success",
    }),
  };
}

function createMockAgentWithValidation(
  type: SubAgentType,
  validationResult: ValidationResult,
): SubAgent {
  return {
    type,
    name: `mock-${type}-with-validation`,
    description: `Mock ${type} agent with validation`,
    canHandle: () => true,
    validate: () => validationResult,
    execute: async (): Promise<SubAgentResult> => ({
      stepId: "test",
      status: "success",
    }),
  };
}

function createStep(id: string, type: "file" | "shell" | "browser" | "gui"): Step {
  return {
    id,
    type,
    desc: `Step ${id}`,
    dependsOn: [],
    timeoutMs: 5000,
    action:
      type === "file"
        ? { op: "read", path: "/tmp/test.txt" }
        : type === "shell"
          ? { command: "echo test" }
          : type === "browser"
            ? { action: "navigate", url: "https://example.com" }
            : { action: "click" },
  };
}
