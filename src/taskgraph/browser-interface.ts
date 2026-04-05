// src/taskgraph/browser-interface.ts
/**
 * BrowserInterface — Abstract browser contract
 *
 * Decouples the VisionVerificationHook and Scrubber from the specific driver
 * (Playwright, CDP, Puppeteer). Implement this interface to provide real
 * browser access; a MockBrowserInterface is used for testing.
 */

export interface BrowserInterface {
  /**
   * Get the full HTML of the current page.
   * The raw HTML is fed to the Scrubber before being passed to the model.
   */
  getContent(): Promise<string>;

  /**
   * Get a visual snapshot of the current page.
   *
   * @param options.quality  JPEG quality 1-100 (default: 50). Lower = fewer tokens.
   * @param options.fullPage  Capture full scrollable page (default: false).
   * @returns PNG/JPEG buffer or base64 string, depending on driver.
   */
  getScreenshot(options?: { quality?: number; fullPage?: boolean }): Promise<Buffer | string>;

  /**
   * Check whether a selector target is visible to the user.
   * Handles occlusion, display:none, visibility:hidden, z-index stacking.
   */
  isVisible(selector: string): Promise<boolean>;

  /**
   * Get the current page URL.
   * Useful for verifying navigation, 404, or redirect destinations.
   */
  getUrl(): Promise<string>;

  /**
   * Get a weak-synchronous snapshot bundle containing scrubbed DOM and screenshot
   * captured at the same moment. Falls back to individual getContent/getScreenshot
   * calls when not implemented.
   */
  getVisualContext?(): Promise<VisualContext>;
}

/**
 * Mock implementation for tests and environments without a real browser.
 * Returns synthetic data so hook logic (triggering, escalation) can be tested.
 */
export class MockBrowserInterface implements BrowserInterface {
  private _content: string;
  private _screenshot: Buffer | string;
  private _url: string;
  private _visibility: Map<string, boolean>;

  constructor(opts?: {
    content?: string;
    screenshot?: Buffer | string;
    url?: string;
    visibility?: Record<string, boolean>;
  }) {
    this._content = opts?.content ?? "<html><body>Mock page</body></html>";
    this._screenshot = opts?.screenshot ?? Buffer.from("mock-screenshot");
    this._url = opts?.url ?? "https://example.com";
    this._visibility = new Map(Object.entries(opts?.visibility ?? { "*": true }));
  }

  async getContent(): Promise<string> {
    return this._content;
  }

  async getScreenshot(_options?: {
    quality?: number;
    fullPage?: boolean;
  }): Promise<Buffer | string> {
    return this._screenshot;
  }

  async isVisible(selector: string): Promise<boolean> {
    return this._visibility.get(selector) ?? this._visibility.get("*") ?? false;
  }

  async getUrl(): Promise<string> {
    return this._url;
  }
}

/**
 * DOM stability status emitted by ensureStabilized().
 * "stable" = DOM stopped mutating for quietThresholdMs; snapshot is trustworthy.
 * "timeout_partial" = hard timeout hit; snapshot may be partially hydrated.
 * "unknown" = no stability check has run yet.
 */
export type StabilityStatus = "stable" | "timeout_partial" | "unknown";

/**
 * Bundles screenshot and scrubbed DOM captured in the same stability window.
 * Returned by getVisualContext().
 */
export interface VisualContext {
  /** JPEG/PNG screenshot. JPEG at configured quality (default 60) when supported. */
  screenshot: Buffer | string;
  /** scrubHtml() output — minimal semantic HTML skeleton. */
  domSnapshot: string;
  /** Unix ms timestamp of capture. */
  capturedAt: number;
  /** DOM stability status at capture time. */
  stability: StabilityStatus;
  /**
   * CDP atomic path: structured node tree with DPI-corrected boundingBox.
   * Present when snapshot was captured via getCDPAtomicContext().
   * Used by LLM vision prompts for precise element references.
   */
  nodes?: import("./scrubber.js").CDPSnapshotNode[];
}

/**
 * Stability detection tuning parameters.
 */
export interface StabilityOptions {
  /** Milliseconds the DOM must stay mutation-free to be considered stable. Default: 300 */
  quietThresholdMs?: number;
  /** Hard timeout — forces return after this many ms even if DOM is still changing. Default: 3000 */
  hardTimeoutMs?: number;
  /** Polling interval between stability checks (ms). Default: 50 */
  pollIntervalMs?: number;
}

/**
 * iframe processing tuning parameters.
 */
export interface IFrameOptions {
  /** Replace <iframe> with semantic placeholder (data-frame-* attributes). Default: true */
  extractLabel?: boolean;
}

/**
 * Configuration for PlaywrightAdapter.
 */
export interface PlaywrightAdapterOptions {
  /** A running Playwright Page instance. Lifecycle is managed externally. */
  page: import("playwright").Page;
  /** Stability detection parameters. Default: quietThresholdMs=300, hardTimeoutMs=3000, pollIntervalMs=50 */
  stability?: StabilityOptions;
  /** iframe placeholder parameters. Default: extractLabel=true */
  iframe?: IFrameOptions;
  /** scrubHtml maxLength in chars. Default: 8000 */
  scrubMaxLength?: number;
  /** JPEG quality 1-100 for screenshot(). Default: 60 */
  screenshotQuality?: number;
  /** Enable CDP atomic snapshot path (default: false for backward compatibility) */
  useCDPAtomic?: boolean;
}

/**
 * PlaywrightAdapter implements BrowserInterface using a real Playwright Page.
 * The Page instance is injected externally (B-mode lifecycle — caller owns launch/close).
 * See PlaywrightAdapterOptions for configuration.
 * Actual implementation lives in src/taskgraph/adapters/playwright-adapter.ts.
 */
export declare class PlaywrightAdapter implements BrowserInterface {
  constructor(page: import("playwright").Page, options?: PlaywrightAdapterOptions);
  getContent(): Promise<string>;
  getScreenshot(options?: { quality?: number; fullPage?: boolean }): Promise<Buffer | string>;
  isVisible(selector: string): Promise<boolean>;
  getUrl(): Promise<string>;
  getVisualContext(): Promise<VisualContext>;
  /** Returns the last observed stability status without triggering a new check. */
  lastStabilityStatus(): StabilityStatus;
}
