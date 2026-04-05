// src/taskgraph/adapters/playwright-adapter.ts
/**
 * PlaywrightAdapter — BrowserInterface implementation backed by Playwright.
 *
 * Lifecycle: Page instance is injected externally (B-mode).
 * Stability: Adaptive MutationObserver polling via ensureStabilized().
 * iframe: Semantically replaced with data-frame-* placeholders.
 * Snapshots: getVisualContext() bundles screenshot + scrubbed DOM atomically.
 */

import type {
  BrowserInterface,
  VisualContext,
  StabilityStatus,
  PlaywrightAdapterOptions,
} from "../browser-interface.js";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { scrubHtml } from "../scrubber.js";

// Re-export config types from browser-interface so consumers only need one import
export type {
  PlaywrightAdapterOptions,
  StabilityOptions,
  IFrameOptions,
} from "../browser-interface.js";

// Skeleton helpers — used by ensureStabilized() implemented in Task 2
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Skeleton helper — used by iframe scrubbing implemented in Task 2
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class PlaywrightAdapter implements BrowserInterface {
  private page: import("playwright").Page;
  private opts: Required<PlaywrightAdapterOptions>;
  private _lastStabilityStatus: StabilityStatus = "unknown";
  private _activeObserver: MutationObserver | null = null;

  constructor(page: import("playwright").Page, options?: PlaywrightAdapterOptions) {
    this.page = page;
    this.opts = {
      page,
      stability: {
        quietThresholdMs: options?.stability?.quietThresholdMs ?? 300,
        hardTimeoutMs: options?.stability?.hardTimeoutMs ?? 3000,
        pollIntervalMs: options?.stability?.pollIntervalMs ?? 50,
      },
      iframe: {
        extractLabel: options?.iframe?.extractLabel ?? true,
      },
      scrubMaxLength: options?.scrubMaxLength ?? 8000,
      screenshotQuality: options?.screenshotQuality ?? 60,
    };
  }

  lastStabilityStatus(): StabilityStatus {
    return this._lastStabilityStatus;
  }

  // Placeholder — implemented in Task 2
  async getContent(): Promise<string> {
    throw new Error("Not yet implemented");
  }

  // Placeholder — implemented in Task 2
  async getScreenshot(_options?: {
    quality?: number;
    fullPage?: boolean;
  }): Promise<Buffer | string> {
    throw new Error("Not yet implemented");
  }

  // Placeholder — implemented in Task 2
  async isVisible(_selector: string): Promise<boolean> {
    throw new Error("Not yet implemented");
  }

  // Placeholder — implemented in Task 2
  async getUrl(): Promise<string> {
    throw new Error("Not yet implemented");
  }

  // Placeholder — implemented in Task 2
  async getVisualContext(): Promise<VisualContext> {
    throw new Error("Not yet implemented");
  }
}
