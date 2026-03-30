// src/taskgraph/planner.ts
/**
 * TaskGraph Planner
 *
 * Generates a complete TaskGraph from user goal and context.
 * Uses LLM to create structured execution plan with assertions.
 */

import { DEFAULT_TASK_LIMITS } from "./limits.js";
import { generateTaskId } from "./store.js";
import type { TaskGraph, Step, TaskLimits, Assertion } from "./types.js";

/**
 * LLM planner function type.
 * Takes goal and context, returns structured plan.
 */
export type LlmPlannerFn = (prompt: string) => Promise<PlannerOutput>;

/**
 * Planner output from LLM.
 */
export interface PlannerOutput {
  goal: string;
  goalAssertion: Assertion;
  steps: PlannerStep[];
}

/**
 * Step output from LLM planner.
 */
export interface PlannerStep {
  id: string;
  type: Step["type"];
  desc: string;
  dependsOn: string[];
  timeoutMs: number;
  action: Step["action"];
}

/**
 * Context provided to planner.
 */
export interface PlannerContext {
  /** Working directory */
  workingDir?: string;

  /** Available tools/agents */
  availableAgents?: string[];

  /** Previous steps (for replanning) */
  previousSteps?: Step[];

  /** Failed steps (for replanning) */
  failedSteps?: string[];

  /** Additional context from Viking Router */
  vikingContext?: {
    intent: string;
    requiredFiles: string[];
    requiredTools: string[];
  };
}

/**
 * TaskGraphPlanner generates execution plans from goals.
 */
export class TaskGraphPlanner {
  private llmPlanner: LlmPlannerFn;

  constructor(llmPlanner: LlmPlannerFn) {
    this.llmPlanner = llmPlanner;
  }

  /**
   * Plan a TaskGraph from user goal.
   *
   * @param goal - User's goal description
   * @param limits - Hard limits for the task
   * @param context - Additional planning context
   * @returns Complete TaskGraph ready for execution
   */
  async plan(
    goal: string,
    limits: TaskLimits = DEFAULT_TASK_LIMITS,
    context?: PlannerContext,
  ): Promise<TaskGraph> {
    const prompt = this.buildPrompt(goal, limits, context);
    const output = await this.llmPlanner(prompt);

    const taskId = generateTaskId();
    const steps = this.validateAndFixSteps(output.steps, limits);

    return {
      taskId,
      goal: output.goal,
      goalAssertion: output.goalAssertion,
      steps,
      limits,
      status: "pending",
      currentStepIndex: 0,
      replanCount: 0,
    };
  }

  /**
   * Replan partially based on execution results.
   *
   * @param existingGraph - Existing TaskGraph
   * @param completedSteps - IDs of successfully completed steps
   * @param failedStep - The step that failed
   * @param errorMessage - Error message from failure
   * @returns New TaskGraph with partial replan
   */
  async replan(
    existingGraph: TaskGraph,
    completedSteps: string[],
    failedStep: string,
    errorMessage: string,
  ): Promise<TaskGraph> {
    const prompt = this.buildReplanPrompt(existingGraph, completedSteps, failedStep, errorMessage);

    const output = await this.llmPlanner(prompt);

    // Keep completed steps, add new steps for recovery
    const completedStepObjs = existingGraph.steps.filter((s) => completedSteps.includes(s.id));

    const newSteps = this.validateAndFixSteps(output.steps, existingGraph.limits);

    // New steps depend on last completed step
    const lastCompletedId = completedSteps[completedSteps.length - 1];
    for (const step of newSteps) {
      if (step.dependsOn.length === 0 && lastCompletedId) {
        step.dependsOn = [lastCompletedId];
      }
    }

    const allSteps = [...completedStepObjs, ...newSteps];

    return {
      ...existingGraph,
      steps: allSteps,
      status: "replanning",
      currentStepIndex: completedSteps.length,
      replanCount: existingGraph.replanCount + 1,
    };
  }

  /**
   * Build planning prompt.
   */
  private buildPrompt(goal: string, limits: TaskLimits, context?: PlannerContext): string {
    const sections = [
      "# Task Planning Request",
      "",
      `## Goal\n${goal}`,
      "",
      `## Limits\n- Maximum steps: ${limits.maxSteps}\n- Maximum replans: ${limits.maxReplans}`,
      "",
    ];

    if (context?.workingDir) {
      sections.push(`## Working Directory\n${context.workingDir}`);
      sections.push("");
    }

    if (context?.availableAgents?.length) {
      sections.push(`## Available Agents\n${context.availableAgents.join(", ")}`);
      sections.push("");
    }

    if (context?.vikingContext) {
      sections.push(`## Viking Context`);
      sections.push(`- Intent: ${context.vikingContext.intent}`);
      if (context.vikingContext.requiredFiles.length > 0) {
        sections.push(`- Required files: ${context.vikingContext.requiredFiles.join(", ")}`);
      }
      if (context.vikingContext.requiredTools.length > 0) {
        sections.push(`- Required tools: ${context.vikingContext.requiredTools.join(", ")}`);
      }
      sections.push("");
    }

    sections.push(`## Output Format (JSON only)`);
    sections.push(``);
    sections.push(`Provide a JSON object with:`);
    sections.push(`- goal: refined goal description`);
    sections.push(`- goalAssertion: assertion to verify completion`);
    sections.push(`- steps: array of execution steps`);
    sections.push(``);
    sections.push(
      `Each step must have: id, type (file/shell/gui/browser), desc, dependsOn, timeoutMs, action`,
    );
    sections.push(``);
    sections.push(
      `Assertion types: file_exists, file_count_equals, directory_not_empty, file_contains, all_of, any_of`,
    );
    sections.push(``);
    sections.push(`JSON only, no markdown.`);

    return sections.join("\n");
  }

  /**
   * Build replanning prompt.
   */
  private buildReplanPrompt(
    existingGraph: TaskGraph,
    completedSteps: string[],
    failedStep: string,
    errorMessage: string,
  ): string {
    const completedStepDescs = existingGraph.steps
      .filter((s) => completedSteps.includes(s.id))
      .map((s) => `- ${s.id}: ${s.desc}`)
      .join("\n");

    const failedStepObj = existingGraph.steps.find((s) => s.id === failedStep);

    const sections = [
      "# Replanning Request",
      "",
      `## Original Goal\n${existingGraph.goal}`,
      "",
      `## Completed Steps\n${completedStepDescs || "None"}`,
      "",
      `## Failed Step\n- ${failedStep}: ${failedStepObj?.desc}\n- Error: ${errorMessage}`,
      "",
      `## Remaining Replans\n${existingGraph.limits.maxReplans - existingGraph.replanCount} remaining`,
      "",
      `## Request\nProvide recovery steps to complete the goal.`,
      `Output JSON with goalAssertion and steps array.`,
      `New steps should depend on the last completed step.`,
    ];

    return sections.join("\n");
  }

  /**
   * Validate and fix steps from LLM output.
   */
  private validateAndFixSteps(steps: PlannerStep[], limits: TaskLimits): Step[] {
    const validated: Step[] = [];

    // Ensure step count doesn't exceed limits
    const maxSteps = Math.min(steps.length, limits.maxSteps);

    for (let i = 0; i < maxSteps; i++) {
      const step = steps[i];

      // Fix missing ID
      if (!step.id) {
        step.id = `step-${i + 1}`;
      }

      // Fix missing timeout
      if (!step.timeoutMs || step.timeoutMs <= 0) {
        step.timeoutMs = 30000;
      }

      // Validate dependencies exist
      const validDependsOn = step.dependsOn.filter((dep) =>
        steps.slice(0, i).some((s) => s.id === dep),
      );

      validated.push({
        id: step.id,
        type: step.type,
        desc: step.desc,
        dependsOn: validDependsOn,
        timeoutMs: step.timeoutMs,
        action: step.action,
      });
    }

    return validated;
  }
}
