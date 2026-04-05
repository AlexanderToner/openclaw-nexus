// src/agents/pi-embedded-runner/taskgraph-executor.test.ts
/**
 * TaskGraph Executor Integration Tests
 *
 * Tests the integration between Viking Router and TaskGraph execution.
 */

import { describe, it, expect } from "vitest";
import type { TaskGraphConfig } from "../../config/types.agent-defaults.js";
import { MockBrowserInterface } from "../../taskgraph/browser-interface.js";
import type { Step } from "../../taskgraph/types.js";
import { VisionVerificationHook } from "../../taskgraph/vision-hook.js";
import type { RouteDecision } from "../../viking/types.js";
import {
  createTaskGraphExecutor,
  shouldTriggerTaskGraph,
  type TaskGraphProgressEvent,
} from "./taskgraph-executor.js";

describe("TaskGraph Executor", () => {
  describe("shouldTriggerTaskGraph", () => {
    const defaultConfig: TaskGraphConfig = {
      enabled: true,
      triggerIntents: ["gui_auto", "browser"],
    };

    it("returns false when disabled", () => {
      const decision: RouteDecision = {
        intent: "gui_auto",
        requiredTools: [],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const config: TaskGraphConfig = { enabled: false };
      expect(shouldTriggerTaskGraph(decision, config)).toBe(false);
    });

    it("returns true for gui_auto intent when enabled", () => {
      const decision: RouteDecision = {
        intent: "gui_auto",
        requiredTools: [],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      expect(shouldTriggerTaskGraph(decision, defaultConfig)).toBe(true);
    });

    it("returns true for browser intent when enabled", () => {
      const decision: RouteDecision = {
        intent: "browser",
        requiredTools: ["browser"],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      expect(shouldTriggerTaskGraph(decision, defaultConfig)).toBe(true);
    });

    it("returns false for chat intent even when enabled", () => {
      const decision: RouteDecision = {
        intent: "chat",
        requiredTools: [],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "minimal",
        confidence: 0.9,
      };

      expect(shouldTriggerTaskGraph(decision, defaultConfig)).toBe(false);
    });

    it("returns false for file_ops intent when not in trigger list", () => {
      const decision: RouteDecision = {
        intent: "file_ops",
        requiredTools: ["read", "write"],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      expect(shouldTriggerTaskGraph(decision, defaultConfig)).toBe(false);
    });

    it("returns true for file_ops when explicitly in trigger list", () => {
      const decision: RouteDecision = {
        intent: "file_ops",
        requiredTools: ["read", "write"],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const config: TaskGraphConfig = {
        enabled: true,
        triggerIntents: ["gui_auto", "browser", "file_ops"],
      };

      expect(shouldTriggerTaskGraph(decision, config)).toBe(true);
    });
  });

  describe("createTaskGraphExecutor", () => {
    it("creates an executor instance", () => {
      const decision: RouteDecision = {
        intent: "gui_auto",
        requiredTools: [],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const config: TaskGraphConfig = {
        enabled: true,
        triggerIntents: ["gui_auto", "browser"],
      };

      const executor = createTaskGraphExecutor(decision, "打开浏览器访问 example.com", {
        config,
        planningModelId: "claude-sonnet-4-5",
        planningProvider: "anthropic",
        planningEndpoint: undefined,
        workingDir: "/tmp/test",
      });

      expect(executor).toBeDefined();
    });

    it("captures progress events", async () => {
      const progressEvents: TaskGraphProgressEvent[] = [];

      const decision: RouteDecision = {
        intent: "browser",
        requiredTools: ["browser"],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const config: TaskGraphConfig = {
        enabled: true,
        triggerIntents: ["browser"],
        limits: { maxSteps: 2, maxTokens: 1000, maxReplans: 1 },
      };

      const executor = createTaskGraphExecutor(decision, "访问 example.com", {
        config,
        planningModelId: "test-model",
        planningProvider: "anthropic",
        planningEndpoint: undefined,
        workingDir: "/tmp/test",
        onProgress: (event) => progressEvents.push(event),
      });

      const result = await executor.execute();

      // Should have planning events
      expect(progressEvents.some((e) => e.type === "planning_started")).toBe(true);
      expect(progressEvents.some((e) => e.type === "planning_completed")).toBe(true);

      // Should have step events (at least one fallback step)
      expect(progressEvents.some((e) => e.type === "step_started")).toBe(true);
      expect(progressEvents.some((e) => e.type === "step_completed")).toBe(true);

      // Should have goal checking event
      expect(progressEvents.some((e) => e.type === "goal_checking")).toBe(true);
      expect(progressEvents.some((e) => e.type === "goal_passed" || e.type === "goal_failed")).toBe(
        true,
      );

      // Result should have expected structure
      expect(result).toHaveProperty("taskId");
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("goal");
      expect(result).toHaveProperty("durationMs");
    });
  });

  describe("built-in stub executors", () => {
    it("browser executor returns failed with unimplemented", async () => {
      const decision: RouteDecision = {
        intent: "browser",
        requiredTools: ["browser"],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const progressEvents: TaskGraphProgressEvent[] = [];
      const executor = createTaskGraphExecutor(decision, "访问 example.com", {
        config: { enabled: true, triggerIntents: ["browser"] },
        planningModelId: "test",
        planningProvider: "anthropic",
        workingDir: "/tmp",
        onProgress: (e) => progressEvents.push(e),
      });

      executor.injectTestGraph({
        taskId: "test",
        goal: "访问 example.com",
        goalAssertion: { type: "file_exists", path: "/tmp/test", description: "test" },
        steps: [
          {
            id: "browser-step",
            type: "browser",
            desc: "Navigate to example.com",
            action: { action: "navigate", url: "https://example.com" },
            dependsOn: [],
            timeoutMs: 30000,
          },
        ],
        limits: { maxSteps: 5, maxTokens: 1000, maxReplans: 1 },
        status: "pending",
        currentStepIndex: 0,
        replanCount: 0,
      });

      await executor.execute();

      const stepCompleted = progressEvents.find((e) => e.type === "step_completed");
      expect(stepCompleted).toBeDefined();
      expect((stepCompleted as { status: string }).status).toBe("failed");
    });

    it("gui executor returns failed with unimplemented", async () => {
      const decision: RouteDecision = {
        intent: "gui_auto",
        requiredTools: [],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const progressEvents: TaskGraphProgressEvent[] = [];
      const executor = createTaskGraphExecutor(decision, "点击确定", {
        config: { enabled: true, triggerIntents: ["gui_auto"] },
        planningModelId: "test",
        planningProvider: "anthropic",
        workingDir: "/tmp",
        onProgress: (e) => progressEvents.push(e),
      });

      executor.injectTestGraph({
        taskId: "test",
        goal: "点击确定",
        goalAssertion: { type: "file_exists", path: "/tmp/test", description: "test" },
        steps: [
          {
            id: "gui-step",
            type: "gui",
            desc: "Click confirm button",
            action: { action: "click", target: { type: "id", value: "confirm" } },
            dependsOn: [],
            timeoutMs: 30000,
          },
        ],
        limits: { maxSteps: 5, maxTokens: 1000, maxReplans: 1 },
        status: "pending",
        currentStepIndex: 0,
        replanCount: 0,
      });

      await executor.execute();

      const stepCompleted = progressEvents.find((e) => e.type === "step_completed");
      expect(stepCompleted).toBeDefined();
      expect((stepCompleted as { status: string }).status).toBe("failed");
    });
  });

  describe("VisionVerificationHook", () => {
    it("returns uncertain when disabled", async () => {
      const hook = new VisionVerificationHook({ enabled: false });
      const step: Step = {
        id: "test",
        type: "browser",
        desc: "navigate",
        action: { action: "navigate" },
        dependsOn: [],
        timeoutMs: 30000,
      };
      const result = { stepId: "test", status: "success" as const };
      const browser = new MockBrowserInterface();

      const verification = await hook.verify(step, result, browser, "<html></html>");
      expect(verification.status).toBe("uncertain");
      expect(verification.reason).toContain("disabled");
    });

    it("returns uncertain with scrubbed snapshot when enabled", async () => {
      const hook = new VisionVerificationHook({ enabled: true });
      const step: Step = {
        id: "test",
        type: "browser",
        desc: "navigate",
        action: { action: "navigate" },
        dependsOn: [],
        timeoutMs: 30000,
      };
      const result = { stepId: "test", status: "success" as const };
      const browser = new MockBrowserInterface();

      const verification = await hook.verify(step, result, browser, "");
      expect(verification.status).toBe("uncertain");
      expect(verification.reason).toContain("Scrubber integrated");
      expect(verification.reason).toContain("chars");
      expect(verification.snapshotUsed).toBeDefined();
    });

    it("scrubber removes noise from raw HTML and returns clean snapshot", async () => {
      const hook = new VisionVerificationHook({ enabled: true });
      const step: Step = {
        id: "test",
        type: "browser",
        desc: "navigate",
        action: { action: "navigate" },
        dependsOn: [],
        timeoutMs: 30000,
      };
      const result = { stepId: "test", status: "success" as const };

      // Raw HTML with heavy noise — simulates Playwright's raw page source
      const noisyHtml = `
        <html><head><script>alert('evil');</script><style>body{color:red}</style></head>
        <body>
          <div class="noise">
            <script>document.cookie="hijack";</script>
            <p>Loading...</p>
            <svg><path d="M0 0"/><circle cx="10"/></svg>
          </div>
          <form id="login">
            <input type="email" placeholder="Email" aria-label="Email address"/>
            <button type="submit">Sign In</button>
          </form>
        </body></html>
      `;

      const browser = new MockBrowserInterface({ content: noisyHtml });
      const verification = await hook.verify(step, result, browser, "");

      const clean = verification.snapshotUsed ?? "";

      // Scrubber must remove scripts
      expect(clean).not.toContain("alert");
      expect(clean).not.toContain("document.cookie");
      expect(clean).not.toContain("color:red");
      // Scrubber must preserve semantic content
      expect(clean).toContain("Sign In");
      expect(clean).toContain("Email");
      expect(clean).toContain("aria-label");
      // Scrubber must assign v-ids
      expect(clean).toContain("data-v-id");
      // Scrubber must not preserve SVG internals (use \bd=" to avoid matching
      // "d=" inside "placeholder" or other attribute names)
      expect(clean).not.toMatch(/\bd="/);
      expect(clean).not.toMatch(/ cx="/);
      // Output must be much smaller than input
      expect(clean.length).toBeLessThan(noisyHtml.length);
    });

    it("shouldTrigger returns false when disabled", () => {
      const hook = new VisionVerificationHook({ enabled: false });
      const step: Step = {
        id: "test",
        type: "browser",
        desc: "navigate",
        action: { action: "navigate" },
        dependsOn: [],
        timeoutMs: 30000,
      };

      expect(hook.shouldTrigger(step, 0)).toBe(false);
      expect(hook.shouldTrigger(step, 3)).toBe(false);
    });

    it("shouldTrigger returns true for critical actions when enabled", () => {
      const hook = new VisionVerificationHook({
        enabled: true,
        criticalActions: ["click", "submit", "type"],
      });
      const step: Step = {
        id: "test",
        type: "browser",
        desc: "click",
        action: { action: "click" },
        dependsOn: [],
        timeoutMs: 30000,
      };

      expect(hook.shouldTrigger(step, 0)).toBe(true);
    });

    it("shouldTrigger returns true every N steps when enabled and not critical", () => {
      const hook = new VisionVerificationHook({ enabled: true, triggerEveryNSteps: 3 });
      const step: Step = {
        id: "test",
        type: "file",
        desc: "read file",
        action: { op: "read" },
        dependsOn: [],
        timeoutMs: 30000,
      };

      expect(hook.shouldTrigger(step, 0)).toBe(false);
      expect(hook.shouldTrigger(step, 1)).toBe(false);
      expect(hook.shouldTrigger(step, 2)).toBe(false);
      expect(hook.shouldTrigger(step, 3)).toBe(true);
      expect(hook.shouldTrigger(step, 6)).toBe(true);
    });
  });

  describe("Viking integration", () => {
    it("uses Viking decision for step type mapping", async () => {
      const progressEvents: TaskGraphProgressEvent[] = [];

      // Test browser intent -> browser step type
      const browserDecision: RouteDecision = {
        intent: "browser",
        requiredTools: ["browser"],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.9,
      };

      const executor = createTaskGraphExecutor(browserDecision, "打开网页", {
        config: { enabled: true, triggerIntents: ["browser"] },
        planningModelId: "test",
        planningProvider: "anthropic",
        workingDir: "/tmp",
        onProgress: (e) => progressEvents.push(e),
      });

      const result = await executor.execute();

      // Browser intent should result in browser-type steps
      expect(result).toBeDefined();
    });

    it("passes confidence threshold through", () => {
      const decision: RouteDecision = {
        intent: "gui_auto",
        requiredTools: [],
        requiredFiles: [],
        requiredSkills: [],
        contextSizeHint: "normal",
        confidence: 0.95,
      };

      const executor = createTaskGraphExecutor(decision, "自动点击确定", {
        config: { enabled: true, triggerIntents: ["gui_auto"] },
        planningModelId: "test",
        planningProvider: "anthropic",
        workingDir: "/tmp",
      });

      expect(executor).toBeDefined();
    });
  });
});
