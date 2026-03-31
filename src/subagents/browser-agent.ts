// src/subagents/browser-agent.ts
/**
 * BrowserAgent
 *
 * Handles browser automation: navigate, click, type, extract, screenshot, wait.
 * Uses minimal context to reduce token consumption.
 *
 * Note: This is a foundation implementation. Full browser automation
 * requires integration with Puppeteer or Playwright.
 */

import type { Step, BrowserAction } from "../taskgraph/types.js";
import { createSubAgentError } from "./errors.js";
import type { SubAgent, SubAgentContext, SubAgentResult } from "./types.js";

/**
 * BrowserAgent handles browser automation operations.
 *
 * Operations:
 * - navigate: Navigate to URL
 * - click: Click element by selector
 * - type: Type text into element
 * - extract: Extract data from page
 * - screenshot: Capture page screenshot
 * - wait: Wait for element or condition
 */
export class BrowserAgent implements SubAgent {
  type = "browser" as const;
  name = "browser-agent";
  description = "Handles browser automation operations";

  /**
   * Check if this agent can handle a step.
   */
  canHandle(step: Step): boolean {
    return step.type === "browser";
  }

  /**
   * Execute a browser automation step.
   */
  async execute(step: Step, context: SubAgentContext): Promise<SubAgentResult> {
    const action = step.action as BrowserAction;
    const startTime = Date.now();

    try {
      // Security check for URL
      if (action.url) {
        this.checkUrlSecurity(action.url, context);
      }

      const result = await this.executeAction(action, context);

      return {
        stepId: step.id,
        status: "success",
        output: result,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      const classifiedError = createSubAgentError(error);

      return {
        stepId: step.id,
        status: "failed",
        error: classifiedError,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Check URL against security arbiter.
   */
  private checkUrlSecurity(url: string, context: SubAgentContext): void {
    // Validate URL format first
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Check domain whitelist if security arbiter is configured
    if (!context.securityArbiter) {
      return; // No security arbiter, allow all valid URLs
    }

    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    const checkResult = context.securityArbiter.checkDomain(domain);
    if (!checkResult.allowed) {
      throw new Error(
        `Domain blocked by security policy: ${domain}. Reason: ${checkResult.reason || "Not in whitelist"}`,
      );
    }
  }

  /**
   * Execute a specific browser action.
   */
  private async executeAction(
    action: BrowserAction,
    _context: SubAgentContext,
  ): Promise<BrowserResult> {
    // This is a foundation implementation
    // Real implementation would integrate with Puppeteer/Playwright

    switch (action.action) {
      case "navigate":
        return this.navigate(action);

      case "click":
        return this.click(action);

      case "type":
        return this.typeText(action);

      case "extract":
        return this.extract(action);

      case "screenshot":
        return this.screenshot(action);

      case "wait":
        return this.wait(action);

      default: {
        const _exhaustive: never = action.action;
        throw new Error(`Unknown browser action: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Navigate to URL.
   */
  private async navigate(action: BrowserAction): Promise<BrowserResult> {
    if (!action.url) {
      throw new Error("URL is required for navigate action");
    }

    // Placeholder: Real implementation would use browser automation
    return {
      action: "navigate",
      url: action.url,
      success: true,
      message: `Would navigate to ${action.url}`,
    };
  }

  /**
   * Click element by selector.
   */
  private async click(action: BrowserAction): Promise<BrowserResult> {
    if (!action.selector) {
      throw new Error("Selector is required for click action");
    }

    // Placeholder: Real implementation would use browser automation
    return {
      action: "click",
      selector: action.selector,
      success: true,
      message: `Would click element: ${action.selector}`,
    };
  }

  /**
   * Type text into element.
   */
  private async typeText(action: BrowserAction): Promise<BrowserResult> {
    if (!action.selector || !action.payload) {
      throw new Error("Selector and payload are required for type action");
    }

    // Placeholder: Real implementation would use browser automation
    return {
      action: "type",
      selector: action.selector,
      success: true,
      message: `Would type "${action.payload}" into ${action.selector}`,
    };
  }

  /**
   * Extract data from page.
   */
  private async extract(action: BrowserAction): Promise<BrowserResult> {
    if (!action.selector) {
      throw new Error("Selector is required for extract action");
    }

    // Placeholder: Real implementation would use browser automation
    return {
      action: "extract",
      selector: action.selector,
      success: true,
      message: `Would extract data from ${action.selector}`,
      data: null, // Would contain extracted data
    };
  }

  /**
   * Capture screenshot.
   */
  private async screenshot(_action: BrowserAction): Promise<BrowserResult> {
    // Placeholder: Real implementation would use browser automation
    return {
      action: "screenshot",
      success: true,
      message: "Would capture screenshot",
      data: null, // Would contain screenshot path/base64
    };
  }

  /**
   * Wait for element or condition.
   */
  private async wait(action: BrowserAction): Promise<BrowserResult> {
    const timeoutMs = action.timeoutMs ?? 5000;

    // Placeholder: Real implementation would use browser automation
    return {
      action: "wait",
      selector: action.selector,
      success: true,
      message: action.selector
        ? `Would wait for element: ${action.selector}`
        : `Would wait for ${timeoutMs}ms`,
    };
  }
}

/**
 * Result from browser operation.
 */
export interface BrowserResult {
  /** Action that was performed */
  action: string;

  /** Whether the action succeeded */
  success: boolean;

  /** Human-readable message */
  message: string;

  /** URL if applicable */
  url?: string;

  /** Selector if applicable */
  selector?: string;

  /** Extracted data if applicable */
  data?: unknown;
}
