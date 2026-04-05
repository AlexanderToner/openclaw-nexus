// src/taskgraph/vision-hook.ts
/**
 * Vision Verification Hook
 *
 * Phase 1: Always returns uncertain (disabled by default).
 * Phase 2: Integrate Playwright/Puppeteer to capture DOM + screenshot,
 * use lightweight model for visual check, escalate to main model if uncertain.
 *
 * Classification: Vision Hook failure is an Environment Error — it signals
 * a mismatch between executor's model of the world and reality.
 * Retry strategy for Environment Errors: refresh/reinspect, not re-execute.
 */

import type { BrowserInterface, VisualContext } from "./browser-interface.js";
import type { StepResult } from "./executor.js";
import type { Step } from "./types.js";

export type VerificationStatus = "passed" | "failed" | "uncertain";

export interface VerificationResult {
  status: VerificationStatus;
  reason: string;
  snapshotUsed?: string;
}

export interface VisionHookOptions {
  /** Enable vision verification */
  enabled: boolean;
  /** Check every N completed steps */
  triggerEveryNSteps?: number;
  /** Actions that always trigger a vision check */
  criticalActions?: string[];
  /** Scrubber max output length (chars) */
  scrubMaxLength?: number;
}

const DEFAULT_OPTIONS: VisionHookOptions = {
  enabled: false,
  triggerEveryNSteps: 3,
  criticalActions: ["click", "submit", "type"],
  scrubMaxLength: 8000,
};

/**
 * VisionVerificationHook runs after step execution to confirm
 * visual state matches expected state.
 *
 * Phase 1: captures and scrubs DOM, returns uncertain.
 * Phase 2: real implementation with LLM Judge.
 */
export class VisionVerificationHook {
  private options: VisionHookOptions;

  constructor(options: Partial<VisionHookOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Verify step result against expected visual state.
   *
   * 1. Scrub the raw DOM into minimal semantic skeleton
   * 2. Phase 2: feed to LLM Judge for visual comparison
   * 3. Return VerificationResult
   */
  async verify(
    _step: Step,
    _result: StepResult,
    browser: BrowserInterface,
    domSnapshot: string,
  ): Promise<VerificationResult> {
    if (!this.options.enabled) {
      return { status: "uncertain", reason: "VisionVerificationHook disabled (Phase 1 stub)" };
    }

    let cleanHtml: string;
    let screenshot: Buffer | string | undefined;
    let stability: string = "unknown";

    // Prefer getVisualContext for weak-synchronous snapshot bundle
    if (browser.getVisualContext) {
      try {
        const ctx: VisualContext = await browser.getVisualContext();
        cleanHtml = ctx.domSnapshot;
        screenshot = ctx.screenshot;
        stability = ctx.stability;
      } catch {
        // Fall back to individual methods on adapter error
        cleanHtml = domSnapshot || (await browser.getContent());
        screenshot = await browser.getScreenshot().catch(() => undefined);
        stability = "unknown";
      }
    } else {
      // Legacy path: individual method calls (e.g. MockBrowserInterface)
      cleanHtml = domSnapshot || (await browser.getContent());
      screenshot = await browser.getScreenshot().catch(() => undefined);
      stability = "unknown";
    }

    // Build reason string with stability info
    const screenshotInfo = screenshot
      ? `, ${(Buffer.isBuffer(screenshot) ? screenshot.length : 0) / 1024 < 1 ? "<1" : Math.round((Buffer.isBuffer(screenshot) ? screenshot.length : 0) / 1024)} KB screenshot`
      : "";

    // Phase 2: call LLM Judge here
    return {
      status: "uncertain",
      reason: `VisualContext[stability=${stability}]: ${cleanHtml.length} chars DOM${screenshotInfo}. LLM Judge pending.`,
      snapshotUsed: cleanHtml,
    };
  }

  /**
   * Determine if a vision check should run for this step.
   */
  shouldTrigger(step: Step, completedStepCount: number): boolean {
    if (!this.options.enabled) {
      return false;
    }

    const action = (step.action as unknown as Record<string, unknown>)?.action as
      | string
      | undefined;
    const isCritical = this.options.criticalActions?.includes(action ?? "");
    const isPeriodic =
      completedStepCount > 0 && completedStepCount % (this.options.triggerEveryNSteps ?? 3) === 0;

    return isCritical || isPeriodic;
  }
}
