// src/taskgraph/integration.test.ts
/**
 * TaskGraph Integration Tests
 *
 * Tests the complete pipeline from user input to goal verification.
 * Uses mock SubAgents to validate the architecture without real execution.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SecurityArbiter } from "../security/arbiter.js";
import { SecurityArbiter as SecurityArbiterClass } from "../security/arbiter.js";
import { DEFAULT_SECURITY_POLICY } from "../security/policy-loader.js";
import { VikingRouter } from "../viking/router.js";
import type { RouteDecision } from "../viking/types.js";
import { AssertionEngine } from "./assertion-engine.js";
import { CheckpointManager } from "./checkpoint.js";
import {
  TaskGraphExecutor,
  type SubAgentExecutorFn,
  type ExecutionContext,
  type StepResult,
} from "./executor.js";
import { TaskGraphPlanner, type LlmPlannerFn } from "./planner.js";
import { PartialReplanner } from "./replanner.js";
import { TaskGraphStore } from "./store.js";
import type { Step, StepType } from "./types.js";

describe("TaskGraph Integration", () => {
  const testDir = "/tmp/taskgraph-integration-test";
  let store: TaskGraphStore;
  let securityArbiter: SecurityArbiter;
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    store = new TaskGraphStore(testDir);
    await store.initialize();
    securityArbiter = new SecurityArbiterClass(DEFAULT_SECURITY_POLICY);
    checkpointManager = new CheckpointManager(store);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Pipeline 1: Viking → Security → Planner", () => {
    it("classifies intent and plans TaskGraph with Viking context", async () => {
      // 1. Mock Viking Router components
      const mockDecision: RouteDecision = {
        intent: "file_ops",
        requiredTools: ["fs_read"],
        requiredFiles: ["~/Desktop/test.txt"],
        requiredSkills: [],
        contextSizeHint: "minimal",
        confidence: 0.95,
      };

      const mockClassifier = {
        classify: vi.fn().mockResolvedValue(mockDecision),
      };

      const mockFilter = {
        applyFilters: vi.fn().mockReturnValue({
          filteredTools: mockDecision.requiredTools,
          filteredFiles: mockDecision.requiredFiles,
          filteredSkills: mockDecision.requiredSkills,
        }),
      };

      const vikingRouter = new VikingRouter(mockClassifier as never, mockFilter as never);

      // 2. Classify user message
      const result = await vikingRouter.route("读取桌面上的测试文件");
      const decision = result.decision;

      expect(decision.intent).toBe("file_ops");
      expect(decision.requiredTools).toContain("fs_read");

      // 3. Security check (should pass for allowed path)
      const expandedPath = decision.requiredFiles[0].replace("~", process.env.HOME ?? "~");
      // Desktop is in allowed paths by default
      const securityCheck = securityArbiter.checkPath(expandedPath);
      expect(securityCheck.allowed).toBe(true);

      // 4. Planner generates TaskGraph with Viking context
      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "读取桌面上的测试文件",
        goalAssertion: {
          type: "file_exists",
          path: expandedPath,
          description: "文件应存在",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "读取测试文件",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read", path: expandedPath },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("读取桌面上的测试文件", undefined, {
        vikingContext: {
          intent: decision.intent,
          requiredFiles: decision.requiredFiles,
          requiredTools: decision.requiredTools,
        },
      });

      expect(graph.goal).toContain("测试文件");
      expect(graph.steps).toHaveLength(1);
      expect(graph.steps[0].type).toBe("file");
    });

    it("blocks dangerous operations at security layer", async () => {
      // Security should block /etc/passwd
      const securityCheck = securityArbiter.checkPath("/etc/passwd");

      expect(securityCheck.allowed).toBe(false);
      expect(securityCheck.rule).toBe("blocked_path");
    });
  });

  describe("Pipeline 2: Planner → Store → Executor (Mock)", () => {
    it("plans, stores, and executes TaskGraph end-to-end", async () => {
      // Create marker file for goal assertion
      const markerPath = path.join(testDir, "success-marker.txt");
      await fs.writeFile(markerPath, "done");

      // 1. Planner generates TaskGraph
      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "创建测试文件",
        goalAssertion: {
          type: "file_exists",
          path: markerPath,
          description: "标记文件应存在",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "创建标记文件",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "write", path: markerPath, content: "done" },
          },
          {
            id: "step-2",
            type: "file",
            desc: "验证文件内容",
            dependsOn: ["step-1"],
            timeoutMs: 5000,
            action: { op: "read", path: markerPath },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("创建测试文件");

      // 2. Store persists TaskGraph
      await store.save(graph);

      const loaded = await store.load(graph.taskId);
      expect(loaded).not.toBeNull();
      expect(loaded?.steps).toHaveLength(2);

      // 3. Executor executes with mock agents (skip security for /tmp paths)
      const mockAgents = createMockAgents();
      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);

      const result = await executor.execute(graph, { skipSecurity: true });

      expect(result.status).toBe("completed");
      expect(result.completedSteps).toEqual(["step-1", "step-2"]);
      expect(result.failedSteps).toEqual([]);
      expect(result.goalPassed).toBe(true);

      // 4. Verify store updated
      const finalGraph = await store.load(graph.taskId);
      expect(finalGraph?.currentStepIndex).toBe(2);
    });

    it("handles execution failures with stopOnFailure", async () => {
      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "测试失败处理",
        goalAssertion: {
          type: "file_exists",
          path: path.join(testDir, "test.txt"),
          description: "测试文件",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "成功步骤",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read", path: "/tmp/a.txt" },
          },
          {
            id: "step-2",
            type: "shell",
            desc: "失败步骤",
            dependsOn: ["step-1"],
            timeoutMs: 5000,
            action: { command: "fail-command" },
          },
          {
            id: "step-3",
            type: "file",
            desc: "不应执行",
            dependsOn: ["step-2"],
            timeoutMs: 5000,
            action: { op: "read", path: "/tmp/c.txt" },
          },
        ],
      });

      // Mock agent that fails on shell commands
      const mockAgents = new Map<StepType, SubAgentExecutorFn>();
      mockAgents.set(
        "file",
        async (step: Step): Promise<StepResult> => ({
          stepId: step.id,
          status: "success",
        }),
      );
      mockAgents.set(
        "shell",
        async (step: Step): Promise<StepResult> => ({
          stepId: step.id,
          status: "failed",
          error: {
            type: "execution_error",
            message: "Command failed",
            retryable: false,
          },
        }),
      );

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("测试失败处理");
      await store.save(graph);

      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);
      const result = await executor.execute(graph, { stopOnFailure: true, skipSecurity: true });

      expect(result.status).toBe("failed");
      expect(result.completedSteps).toEqual(["step-1"]);
      expect(result.failedSteps).toEqual(["step-2"]);
    });
  });

  describe("Pipeline 3: Executor → Assertion Engine", () => {
    it("verifies goal completion with file_exists assertion", async () => {
      const testFile = path.join(testDir, "goal-test.txt");
      await fs.writeFile(testFile, "goal content");

      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "创建目标文件",
        goalAssertion: {
          type: "file_exists",
          path: testFile,
          description: "目标文件应存在",
        },
        steps: [],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("创建目标文件");
      await store.save(graph);

      const mockAgents = createMockAgents();
      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);

      const result = await executor.execute(graph, { skipSecurity: true });

      expect(result.goalPassed).toBe(true);
      expect(result.goalReason).toContain("passed");
    });

    it("fails goal assertion when condition not met", async () => {
      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "创建不存在的文件",
        goalAssertion: {
          type: "file_exists",
          path: "/nonexistent/path/file.txt",
          description: "文件应存在",
        },
        steps: [],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("创建不存在的文件");
      await store.save(graph);

      const mockAgents = createMockAgents();
      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);

      const result = await executor.execute(graph, { skipSecurity: true });

      expect(result.goalPassed).toBe(false);
      expect(result.goalReason).toContain("failed");
    });

    it("supports complex assertions with all_of", async () => {
      const fileA = path.join(testDir, "a.txt");
      const fileB = path.join(testDir, "b.txt");
      await fs.writeFile(fileA, "A");
      await fs.writeFile(fileB, "B");

      const assertionEngine = new AssertionEngine();

      const result = await assertionEngine.evaluate({
        type: "all_of",
        description: "所有文件应存在",
        conditions: [
          { type: "file_exists", path: fileA, description: "A exists" },
          { type: "file_exists", path: fileB, description: "B exists" },
        ],
      });

      expect(result).toBe(true);
    });
  });

  describe("Pipeline 4: Failure → Replanner Recovery", () => {
    it("analyzes failure and generates recovery plan", async () => {
      const mockLlmPlanner: LlmPlannerFn = vi
        .fn()
        .mockResolvedValueOnce({
          // Initial plan
          goal: "读取配置文件",
          goalAssertion: {
            type: "file_exists",
            path: "/tmp/config.json",
            description: "配置文件",
          },
          steps: [
            {
              id: "step-1",
              type: "file",
              desc: "读取配置",
              dependsOn: [],
              timeoutMs: 5000,
              action: { op: "read", path: "/tmp/config.json" },
            },
          ],
        })
        .mockResolvedValueOnce({
          // Recovery plan
          goalAssertion: {
            type: "file_exists",
            path: "/tmp/config.json",
            description: "配置文件",
          },
          steps: [
            {
              id: "recovery-1",
              type: "file",
              desc: "创建默认配置",
              dependsOn: [],
              timeoutMs: 5000,
              action: { op: "write", path: "/tmp/config.json", content: "{}" },
            },
          ],
        });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const replanner = new PartialReplanner(mockLlmPlanner);

      // Initial plan
      const graph = await planner.plan("读取配置文件");
      await store.save(graph);

      // Analyze failure
      const analysis = replanner.analyzeFailure(
        graph,
        "step-1",
        "File not found: /tmp/config.json",
      );

      expect(analysis.type).toBe("resource_not_found");
      expect(analysis.recoverable).toBe(true);
      expect(analysis.recoveryApproach).toBe("alternative_approach");

      // Generate recovery
      const recoveredGraph = await replanner.generateRecovery(
        graph,
        [],
        "step-1",
        "File not found",
      );

      expect(recoveredGraph.replanCount).toBe(1);
      expect(recoveredGraph.status).toBe("replanning");
      expect(recoveredGraph.steps).toHaveLength(1);
      expect(recoveredGraph.steps[0].id).toBe("recovery-1");
    });

    it("handles non-recoverable failures", async () => {
      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "读取敏感文件",
        goalAssertion: {
          type: "file_exists",
          path: "/etc/shadow",
          description: "敏感文件",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "读取敏感文件",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read", path: "/etc/shadow" },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const replanner = new PartialReplanner(mockLlmPlanner);

      const graph = await planner.plan("读取敏感文件");

      // Security blocked failure
      const analysis = replanner.analyzeFailure(
        graph,
        "step-1",
        "Security blocked: path not allowed",
      );

      expect(analysis.type).toBe("security_blocked");
      expect(analysis.recoverable).toBe(false);
      expect(analysis.recoveryApproach).toBe("abort");
    });
  });

  describe("Pipeline 5: Security Integration", () => {
    it("blocks execution of disallowed shell commands", async () => {
      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "危险操作",
        goalAssertion: {
          type: "file_exists",
          path: "/tmp/test.txt",
          description: "测试",
        },
        steps: [
          {
            id: "step-1",
            type: "shell",
            desc: "危险命令",
            dependsOn: [],
            timeoutMs: 5000,
            action: { command: "rm -rf /" },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("危险操作");
      await store.save(graph);

      const mockAgents = createMockAgents();
      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);

      const result = await executor.execute(graph);

      expect(result.status).toBe("failed");
      expect(result.goalReason).toContain("Security blocked");
    });

    it("allows execution of safe operations", async () => {
      const markerPath = path.join(testDir, "safe-test.txt");
      await fs.writeFile(markerPath, "safe");

      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "安全操作",
        goalAssertion: {
          type: "file_exists",
          path: markerPath,
          description: "安全文件",
        },
        steps: [
          {
            id: "step-1",
            type: "shell",
            desc: "安全命令",
            dependsOn: [],
            timeoutMs: 5000,
            action: { command: "ls" },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("安全操作");
      await store.save(graph);

      const mockAgents = createMockAgents();
      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);

      const result = await executor.execute(graph);

      expect(result.status).toBe("completed");
      expect(result.completedSteps).toContain("step-1");
    });
  });

  describe("Pipeline 6: Checkpoint Integration", () => {
    it("creates checkpoint and restores from it", async () => {
      const markerPath = path.join(testDir, "checkpoint-test.txt");
      await fs.writeFile(markerPath, "checkpoint");

      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "检查点测试",
        goalAssertion: {
          type: "file_exists",
          path: markerPath,
          description: "检查点文件",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "步骤1",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read", path: markerPath },
          },
          {
            id: "step-2",
            type: "file",
            desc: "步骤2",
            dependsOn: ["step-1"],
            timeoutMs: 5000,
            action: { op: "read", path: markerPath },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("检查点测试");
      await store.save(graph);

      // Create checkpoint before execution
      await checkpointManager.createCheckpoint(
        graph,
        "before-execution",
        "user_requested",
        "执行前检查点",
      );

      // Execute step 1
      graph.currentStepIndex = 1;
      await store.save(graph);

      // Create checkpoint after step 1
      await checkpointManager.createCheckpoint(
        graph,
        "after-step-1",
        "after_phase_complete",
        "步骤1完成后",
      );

      // List checkpoints
      const checkpoints = await checkpointManager.listCheckpoints(graph.taskId);
      expect(checkpoints.length).toBe(2);

      // Restore from checkpoint
      const restored = await checkpointManager.restoreCheckpoint(graph.taskId, "before-execution");

      expect(restored).not.toBeNull();
      expect(restored?.currentStepIndex).toBe(0);
    });
  });

  describe("Pipeline 7: State Propagation", () => {
    it("propagates state between steps", async () => {
      const markerPath = path.join(testDir, "state-test.txt");
      await fs.writeFile(markerPath, "state");

      const mockLlmPlanner: LlmPlannerFn = vi.fn().mockResolvedValue({
        goal: "状态传播测试",
        goalAssertion: {
          type: "file_exists",
          path: markerPath,
          description: "状态文件",
        },
        steps: [
          {
            id: "step-1",
            type: "file",
            desc: "读取并存储状态",
            dependsOn: [],
            timeoutMs: 5000,
            action: { op: "read", path: markerPath },
          },
          {
            id: "step-2",
            type: "file",
            desc: "使用状态",
            dependsOn: ["step-1"],
            timeoutMs: 5000,
            action: { op: "read", path: markerPath },
          },
        ],
      });

      const planner = new TaskGraphPlanner(mockLlmPlanner);
      const graph = await planner.plan("状态传播测试");
      await store.save(graph);

      // Track state propagation
      const stateHistory: Map<string, unknown>[] = [];

      const mockAgents = new Map<StepType, SubAgentExecutorFn>();
      mockAgents.set("file", async (step: Step, ctx: ExecutionContext): Promise<StepResult> => {
        // Record state at this step
        stateHistory.push(new Map(ctx.state));

        if (step.id === "step-1") {
          return {
            stepId: step.id,
            status: "success",
            stateUpdates: {
              fileContent: "test-content",
              processedAt: Date.now(),
            },
          };
        }

        return {
          stepId: step.id,
          status: "success",
        };
      });

      const executor = new TaskGraphExecutor(store, mockAgents, securityArbiter);
      const result = await executor.execute(graph, { skipSecurity: true });

      expect(result.status).toBe("completed");

      // Verify state was propagated
      expect(stateHistory.length).toBe(2);
      expect(stateHistory[1].has("fileContent")).toBe(true);
    });
  });
});

// Helper: Create mock SubAgents
function createMockAgents(): Map<StepType, SubAgentExecutorFn> {
  const agents = new Map<StepType, SubAgentExecutorFn>();

  agents.set(
    "file",
    async (step: Step, _ctx: ExecutionContext): Promise<StepResult> => ({
      stepId: step.id,
      status: "success",
      output: { content: "mock file content" },
    }),
  );

  agents.set(
    "shell",
    async (step: Step, _ctx: ExecutionContext): Promise<StepResult> => ({
      stepId: step.id,
      status: "success",
      output: { stdout: "mock output", stderr: "" },
    }),
  );

  agents.set(
    "browser",
    async (step: Step, _ctx: ExecutionContext): Promise<StepResult> => ({
      stepId: step.id,
      status: "success",
      output: { html: "<html>mock</html>" },
    }),
  );

  agents.set(
    "gui",
    async (step: Step, _ctx: ExecutionContext): Promise<StepResult> => ({
      stepId: step.id,
      status: "success",
      output: { result: "gui action completed" },
    }),
  );

  return agents;
}
