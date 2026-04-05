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
import { scrubHtml, Scrubber } from "../scrubber.js";

// Re-export config types from browser-interface so consumers only need one import
export type {
  PlaywrightAdapterOptions,
  StabilityOptions,
  IFrameOptions,
} from "../browser-interface.js";

// Helper functions used by ensureStabilized()
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function used by iframe scrubbing
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class PlaywrightAdapter implements BrowserInterface {
  private page: import("playwright").Page;
  private opts: Required<PlaywrightAdapterOptions>;
  private _lastStabilityStatus: StabilityStatus = "unknown";
  private frameIdCounter = 0;

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
      useCDPAtomic: options?.useCDPAtomic ?? false,
      captureSubframes: options?.captureSubframes ?? false,
    };
  }

  lastStabilityStatus(): StabilityStatus {
    return this._lastStabilityStatus;
  }

  private inferIFrameLabel(src: string): string {
    if (!src) {
      return "Embedded Frame";
    }
    try {
      const hostname = new URL(src, "http://localhost").hostname;
      const rules: Array<[RegExp, string]> = [
        [/checkout\.stripe\.com/, "Stripe Checkout"],
        [/paypal\.com/, "PayPal Checkout"],
        [/accounts\.google\.com/, "Google Sign-In"],
        [/facebook\.com/, "Facebook Login"],
        [/\.stripe\.com$/, "Payment"],
        [/cdn\.|static\.|assets\./, "Embedded Content"],
      ];
      for (const [pattern, label] of rules) {
        if (pattern.test(hostname)) {
          return label;
        }
      }
      return hostname;
    } catch {
      return "Embedded Frame";
    }
  }

  private processIFrame(el: { getAttribute(name: string): string | null }): string {
    const src = el.getAttribute("src") ?? "";
    const title = el.getAttribute("title");
    const label = title ?? this.inferIFrameLabel(src);
    this.frameIdCounter++;
    const frameId = this.frameIdCounter;
    return `<div data-frame-id="${frameId}" data-frame-src="${escapeAttr(src)}" data-frame-label="${escapeAttr(label)}" role="dialog"></div>`;
  }

  private processIframes(html: string): string {
    if (!this.opts.iframe.extractLabel) {
      return html;
    }
    return html.replace(/<iframe([^>]*)>/gi, (_match, attrs) => {
      const fakeEl = {
        getAttribute: (name: string) => {
          const match = attrs.match(new RegExp(`${name}="([^"]*)"`, "i"));
          return match ? match[1] : null;
        },
      };
      return this.processIFrame(fakeEl as { getAttribute(name: string): string | null });
    });
  }

  private async cleanupStabilityProbe(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        const win = window as unknown as Record<string, unknown>;
        const probe = win.__stabilityProbe as { observer?: MutationObserver } | undefined;
        if (probe?.observer) {
          probe.observer.disconnect();
          probe.observer = undefined;
        }
        delete win.__stabilityProbe;
      });
    } catch {
      // Page may have navigated away during cleanup — silent ignore
      console.warn(
        `[PlaywrightAdapter] Stability probe lost due to navigation. ` +
          `DOM snapshot may reflect the post-navigation state.`,
      );
    }
  }

  private async ensureStabilized(): Promise<StabilityStatus> {
    const stability = this.opts.stability;
    const quietThresholdMs: number = stability.quietThresholdMs ?? 300;
    const hardTimeoutMs: number = stability.hardTimeoutMs ?? 3000;
    const pollIntervalMs: number = stability.pollIntervalMs ?? 50;
    const startTime = Date.now();
    let lastMutation = startTime;

    // Inject MutationObserver into page context
    await this.page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      const existingProbe = win.__stabilityProbe as
        | {
            observer?: MutationObserver;
            lastMutation: number;
          }
        | undefined;
      if (existingProbe?.observer) {
        existingProbe.observer.disconnect();
      }
      const observer = new MutationObserver(() => {
        (win.__stabilityProbe as { lastMutation: number }).lastMutation = Date.now();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      win.__stabilityProbe = { lastMutation: Date.now(), observer };
    });

    let settled = false;
    while (!settled && Date.now() - startTime < hardTimeoutMs) {
      try {
        lastMutation = await this.page.evaluate(() => {
          const win = window as unknown as Record<string, unknown>;
          const p = win.__stabilityProbe as { lastMutation: number } | undefined;
          return p?.lastMutation ?? Date.now();
        });
      } catch {
        settled = true;
        break;
      }
      if (Date.now() - lastMutation >= quietThresholdMs) {
        settled = true;
        break;
      }
      await sleep(pollIntervalMs);
    }

    await this.cleanupStabilityProbe();

    const status = settled ? "stable" : "timeout_partial";
    this._lastStabilityStatus = status;
    return status;
  }

  async getContent(): Promise<string> {
    const rawHtml = await this.page.content();
    const processed = this.processIframes(rawHtml);
    return scrubHtml(processed, { maxLength: this.opts.scrubMaxLength });
  }

  async getUrl(): Promise<string> {
    return this.page.url();
  }

  async getScreenshot(options?: {
    quality?: number;
    fullPage?: boolean;
  }): Promise<Buffer | string> {
    return this.page.screenshot({
      type: "jpeg",
      quality: options?.quality ?? this.opts.screenshotQuality,
      fullPage: options?.fullPage ?? false,
    });
  }

  async isVisible(selector: string): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      return await locator.isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  async getVisualContext(): Promise<VisualContext> {
    const start = performance.now();
    const path = this.opts.useCDPAtomic ? "CDP-Atomic" : "Legacy-HTML";
    let context: VisualContext;

    if (this.opts.useCDPAtomic) {
      context = await this.getCDPAtomicContext();
    } else {
      context = await this.getLegacyContext();
    }

    const duration = performance.now() - start;
    console.debug(
      `[VisualContext] Path: ${path}, Stability: ${context.stability}, ` +
        `Duration: ${duration.toFixed(2)}ms, Nodes: ${context.nodes?.length ?? 0}`,
    );
    return context;
  }

  /**
   * Legacy snapshot path: MutationObserver stabilization + Promise.all screenshot/content.
   * Preserved for backward compatibility; use getVisualContext() which adds observability.
   */
  private async getLegacyContext(): Promise<VisualContext> {
    const stability = await this.ensureStabilized();
    const [screenshot, rawHtml] = await Promise.all([
      this.page.screenshot({ type: "jpeg", quality: this.opts.screenshotQuality }),
      this.page.content(),
    ]);
    const processed = this.processIframes(rawHtml);
    const scrubber = Scrubber.fromHtml(processed, { maxLength: this.opts.scrubMaxLength });
    return {
      screenshot,
      domSnapshot: scrubber.toHtml(),
      capturedAt: Date.now(),
      stability,
    };
  }

  /**
   * CDP atomic snapshot: screenshot and DOM tree captured in the same render frame.
   * Requires useCDPAtomic: true in constructor options.
   * Phase 2b Milestone 1: When captureSubframes=true, also captures same-origin
   * iframe content with absolute coordinate alignment.
   */
  async getCDPAtomicContext(): Promise<VisualContext> {
    const { captureCDPAtomic, captureMultiFrameAtomic } = await import("./cdp-atomic-snapshot.js");

    // Pre-check: ensure page is not still loading
    try {
      const readyState = await this.page.evaluate(() => document.readyState);
      if (readyState === "loading") {
        await this.page.waitForLoadState("domcontentloaded").catch(() => {});
      }
    } catch {}

    try {
      let nodes: import("../scrubber.js").CDPSnapshotNode[];
      let capturedAt: number;
      let screenshot = Buffer.alloc(0);

      if (this.opts.captureSubframes) {
        // Phase 2b Milestone 1: multi-frame capture
        const result = await captureMultiFrameAtomic(this.page, {
          limit: 800,
          maxTextChars: 220,
          quality: this.opts.screenshotQuality,
          captureSubframes: true,
        });
        screenshot = Buffer.from(result.screenshot);
        nodes = result.nodes;
        capturedAt = result.capturedAt;
      } else {
        // Single-frame atomic capture (Phase 2a.6)
        const result = await captureCDPAtomic(this.page, {
          limit: 800,
          maxTextChars: 220,
          quality: this.opts.screenshotQuality,
        });
        screenshot = Buffer.from(result.screenshot);
        nodes = result.nodes;
        capturedAt = result.capturedAt;
      }

      const scrubber = Scrubber.fromNodes(nodes, { maxLength: this.opts.scrubMaxLength });
      const domSnapshot = scrubber.toHtml();
      const scrubbedNodes = scrubber.toNodes();

      return {
        screenshot,
        domSnapshot,
        nodes: scrubbedNodes,
        capturedAt,
        stability: "stable",
      };
    } catch (err) {
      const msg = String(err);
      if (
        msg.includes("Target") ||
        msg.includes("Execution context was destroyed") ||
        msg.includes("Navigation")
      ) {
        console.warn(
          `[PlaywrightAdapter] CDP capture interrupted by navigation ` +
            `at ${Date.now()}. Returning stability=unknown.`,
        );
        return {
          screenshot: Buffer.alloc(0),
          domSnapshot: "",
          nodes: [],
          capturedAt: Date.now(),
          stability: "unknown",
        };
      }
      throw err;
    }
  }
}
