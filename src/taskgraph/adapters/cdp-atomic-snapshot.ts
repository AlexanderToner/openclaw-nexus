/**
 * CDP Atomic Snapshot
 *
 * Captures screenshot and DOM snapshot within a single CDP session,
 * guaranteeing they are taken in the same render frame.
 */

import type { Page } from "playwright-core";
import type { CDPSnapshotNode } from "../scrubber.js";
export type { CDPSnapshotNode };

export class NavigationDuringCaptureError extends Error {
  constructor(
    public readonly capturedAt: number,
    public readonly phase: "pre_check" | "screenshot" | "evaluate",
  ) {
    super(`Navigation detected during CDP capture phase: ${phase}`);
    this.name = "NavigationDuringCaptureError";
  }
}

/**
 * JS expression that captures DOM structure with DPI-corrected boundingBox.
 * DPR (devicePixelRatio) is applied so coordinates align with screenshot pixels.
 */
export const SNAPSHOT_DOM_EXPRESSION = (limit: number, maxTextChars: number): string => {
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
  const safeText = Math.max(0, Math.min(5000, Math.floor(maxTextChars)));
  return `
(() => {
  const dpr = window.devicePixelRatio || 1;
  const INTERACTIVE_TAGS = new Set(["button","a","input","select","textarea","label"]);
  const nodes = [];
  const root = document.documentElement;
  if (!root) return { nodes };
  const stack = [{ el: root, depth: 0, parentRef: null }];

  while (stack.length && nodes.length < ${safeLimit}) {
    const cur = stack.pop();
    const el = cur.el;
    if (!el || el.nodeType !== 1) continue;

    const tag = (el.tagName || "").toLowerCase();
    const ref = "n" + String(nodes.length + 1);
    const id = el.id ? String(el.id) : undefined;
    const className = el.className ? String(el.className).slice(0, 300) : undefined;
    const role = el.getAttribute && el.getAttribute("role") ? String(el.getAttribute("role")) : undefined;
    const name = el.getAttribute && el.getAttribute("aria-label") ? String(el.getAttribute("aria-label")) : undefined;

    let isInteractive = INTERACTIVE_TAGS.has(tag);
    if (!isInteractive) {
      try {
        const style = window.getComputedStyle(el);
        if (style.cursor === "pointer" || el.onclick || el.getAttribute("onclick")) {
          isInteractive = true;
        }
      } catch {}
    }

    let boundingBox = null;
    if (isInteractive) {
      try {
        const rect = el.getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) {
          boundingBox = {
            x: Math.round(rect.left * dpr),
            y: Math.round(rect.top * dpr),
            width: Math.round(rect.width * dpr),
            height: Math.round(rect.height * dpr),
          };
        }
      } catch {}
    }

    let text = "";
    try { text = String(el.innerText || "").trim(); } catch {}
    if (${safeText} && text.length > ${safeText}) text = text.slice(0, ${safeText}) + "…";
    const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
    const type = (el.type !== undefined && el.type !== null) ? String(el.type) : undefined;
    const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;

    nodes.push({
      ref, parentRef: cur.parentRef, depth: cur.depth, tag,
      ...(id ? { id } : {}),
      ...(className ? { className } : {}),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      ...(text ? { text } : {}),
      ...(href ? { href } : {}),
      ...(type ? { type } : {}),
      ...(value ? { value } : {}),
      ...(boundingBox ? { boundingBox } : {}),
    });

    const children = el.children ? Array.from(el.children) : [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ el: children[i], depth: cur.depth + 1, parentRef: ref });
    }
  }
  return { nodes };
})()
`;
};

type CDPSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export async function withCDPAtomicSnapshot<T>(
  page: Page,
  fn: (send: CDPSend) => Promise<T>,
): Promise<T> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Page.enable");
    await session.send("DOM.enable");
    await session.send("Runtime.enable").catch(() => {});
    return await fn((method, params) =>
      (session.send as (m: string, p?: Record<string, unknown>) => Promise<unknown>)(
        method,
        params,
      ),
    );
  } finally {
    await session.detach().catch(() => {});
  }
}

export interface CDPAtomicResult {
  screenshot: Buffer;
  nodes: CDPSnapshotNode[];
  capturedAt: number;
}

export async function captureCDPAtomic(
  page: Page,
  options: { limit?: number; maxTextChars?: number; quality?: number } = {},
): Promise<CDPAtomicResult> {
  const limit = Math.max(1, Math.min(5000, Math.floor(options.limit ?? 800)));
  const maxTextChars = Math.max(0, Math.min(5000, Math.floor(options.maxTextChars ?? 220)));
  const quality = Math.max(1, Math.min(100, Math.round(options.quality ?? 60)));

  return await withCDPAtomicSnapshot(page, async (send) => {
    const capturedAt = Date.now();

    let screenshotResult: unknown;
    try {
      screenshotResult = await send("Page.captureScreenshot", {
        format: "jpeg",
        quality,
        fromSurface: true,
        captureBeyondViewport: true,
      });
    } catch (err) {
      throw new NavigationDuringCaptureError(
        capturedAt,
        isNavigationError(err) ? "screenshot" : "pre_check",
      );
    }

    let nodesResult: unknown;
    try {
      nodesResult = await send("Runtime.evaluate", {
        expression: SNAPSHOT_DOM_EXPRESSION(limit, maxTextChars),
        returnByValue: true,
        awaitPromise: true,
      });
    } catch {
      throw new NavigationDuringCaptureError(capturedAt, "evaluate");
    }

    const base64 = (screenshotResult as { data?: string })?.data ?? "";
    const screenshot = Buffer.from(base64, "base64");
    const nodes = parseNodesFromEvaluateResult(nodesResult);

    return { screenshot, nodes, capturedAt };
  });
}

function isNavigationError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("Target closed") ||
    msg.includes("Execution context was destroyed") ||
    msg.includes("Navigation")
  );
}

export function parseNodesFromEvaluateResult(result: unknown): CDPSnapshotNode[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const r = result as { result?: { value?: unknown } };
  const value = r?.result?.value;
  if (!value || typeof value !== "object") {
    return [];
  }
  const obj = value as { nodes?: unknown };
  const nodes = obj?.nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes as CDPSnapshotNode[];
}

// ============================================================================
// Phase 2b Milestone 1: Multi-Frame CDP Atomic Capture
// ============================================================================

export interface MultiFrameSnapshotNode extends CDPSnapshotNode {
  /** Which frame this node belongs to */
  frameRef: string;
}

export interface MultiFrameAtomicResult {
  screenshot: Buffer;
  nodes: MultiFrameSnapshotNode[];
  capturedAt: number;
  capturedSubframes: number;
}

/**
 * Captures atomic snapshot from the main frame and all sub-frames.
 *
 * Capture strategy (playwright-core 1.58.2):
 * - Main frame: CDP atomic (screenshot + Runtime.evaluate in same session)
 * - All sub-frames: frame.evaluate() — Playwright injects JS API into every frame,
 *   including OOPIFs, so frame.evaluate() works for both same-origin AND cross-origin.
 *
 * Both methods return absolute boundingBox coordinates by adding the parent
 * iframe's getBoundingClientRect offset to child element rects.
 */
export async function captureMultiFrameAtomic(
  page: Page,
  options: {
    limit?: number;
    maxTextChars?: number;
    quality?: number;
    captureSubframes?: boolean;
  } = {},
): Promise<MultiFrameAtomicResult> {
  const limit = Math.max(1, Math.min(5000, Math.floor(options.limit ?? 800)));
  const maxTextChars = Math.max(0, Math.min(5000, Math.floor(options.maxTextChars ?? 220)));
  const quality = Math.max(1, Math.min(100, Math.round(options.quality ?? 60)));
  const captureSubframes = options.captureSubframes ?? false;

  // Enumerate all frames (excluding main)
  const allFrames = page.frames();
  const mainFrame = page.mainFrame();
  const subFrames = captureSubframes ? allFrames.filter((f) => f !== mainFrame) : [];

  const capturedAt = Date.now();

  // ── Main frame atomic capture ─────────────────────────────────────────────
  const session = await page.context().newCDPSession(mainFrame);
  let screenshot = Buffer.alloc(0);

  try {
    await session.send("Page.enable");
    await session.send("DOM.enable");
    await session.send("Runtime.enable").catch(() => {});

    let screenshotResult: unknown;
    try {
      screenshotResult = await session.send("Page.captureScreenshot", {
        format: "jpeg",
        quality,
        fromSurface: true,
        captureBeyondViewport: true,
      });
    } catch (err) {
      throw new NavigationDuringCaptureError(
        capturedAt,
        isNavigationError(err) ? "screenshot" : "pre_check",
      );
    }

    const base64 = (screenshotResult as { data?: string })?.data ?? "";
    screenshot = Buffer.from(base64, "base64");

    // Main frame DOM with ALL boundingBoxes (for iframe offset lookup)
    const mainEvalResult = await session.send("Runtime.evaluate", {
      expression: SNAPSHOT_DOM_EXPRESSION_WITH_BBOX(limit, maxTextChars),
      returnByValue: true,
      awaitPromise: true,
    });
    const mainNodes = parseNodesWithBbox(mainEvalResult);
    const mainNodesTagged: MultiFrameSnapshotNode[] = mainNodes.map((n) => ({
      ...n,
      frameRef: "main",
    }));

    // Build iframe boundingBox map for offset calculation
    const iframeBboxes = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of mainNodes) {
      if (node.tag === "iframe" && node.boundingBox) {
        const key = node.name ?? node.href ?? "";
        if (key) {
          iframeBboxes.set(key, node.boundingBox);
        }
      }
    }

    // ── Sub-frame capture via frame.evaluate() (works for ALL iframe types) ──
    const subFrameResults = await Promise.allSettled(
      subFrames.map(async (frame) => {
        const frameName = frame.name() || fUrl(frame);
        const iframeOffset = iframeBboxes.get(frameName);
        try {
          const evalExpr = SNAPSHOT_DOM_EXPRESSION_WITH_BBOX(limit, maxTextChars);
          const result = await frame.evaluate(evalExpr);
          const nodes = parseNodesWithBboxFromEvalResult(result);
          return tagFrameNodes(nodes, frameName, iframeOffset);
        } catch {
          // frame.evaluate() fails if the iframe has no JS execution context yet
          // (e.g., during rapid navigation). Skip non-fatally.
          return [];
        }
      }),
    );

    // Merge results (non-fatal — skip failed frames)
    const mergedNodes: MultiFrameSnapshotNode[] = [...mainNodesTagged];
    for (const result of subFrameResults) {
      if (result.status === "fulfilled") {
        mergedNodes.push(...result.value);
      }
    }

    const capturedSubframes = subFrameResults.filter(
      (r) => r.status === "fulfilled" && r.value.length > 0,
    ).length;

    return {
      screenshot,
      nodes: mergedNodes,
      capturedAt,
      capturedSubframes,
    };
  } finally {
    await session.detach().catch(() => {});
  }
}

/** Tag frame nodes with frameRef and apply iframe boundingBox offset */
function tagFrameNodes(
  nodes: CDPSnapshotNode[],
  frameName: string,
  iframeOffset: { x: number; y: number; width: number; height: number } | undefined,
): MultiFrameSnapshotNode[] {
  if (iframeOffset) {
    return nodes.map((n) => ({
      ...n,
      frameRef: frameName,
      boundingBox: n.boundingBox
        ? {
            x: n.boundingBox.x + iframeOffset.x,
            y: n.boundingBox.y + iframeOffset.y,
            width: n.boundingBox.width,
            height: n.boundingBox.height,
          }
        : undefined,
    }));
  }
  return nodes.map((n) => ({ ...n, frameRef: frameName }));
}

function fUrl(frame: import("playwright-core").Frame): string {
  try {
    return frame.url();
  } catch {
    return "";
  }
}

/**
 * Parse result from frame.evaluate() — returns the value directly, not wrapped in
 * {result: {value: ...}} like CDP Runtime.evaluate does.
 */
function parseNodesWithBboxFromEvalResult(result: unknown): CDPSnapshotNode[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const obj = result as { nodes?: unknown };
  const nodes = obj?.nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes as CDPSnapshotNode[];
}

/** Parse evaluate result that includes boundingBox in each node (CDP Runtime.evaluate format) */
function parseNodesWithBbox(result: unknown): CDPSnapshotNode[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const r = result as { result?: { value?: unknown } };
  const value = r?.result?.value;
  if (!value || typeof value !== "object") {
    return [];
  }
  const obj = value as { nodes?: unknown };
  const nodes = obj?.nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes as CDPSnapshotNode[];
}

/**
 * Extended DOM expression that includes boundingBox in every node (not just interactive).
 * Used for multi-frame capture where we need all iframe boundingBoxes for offset calculation.
 */
function SNAPSHOT_DOM_EXPRESSION_WITH_BBOX(limit: number, maxTextChars: number): string {
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
  const safeText = Math.max(0, Math.min(5000, Math.floor(maxTextChars)));
  return `
(() => {
  const dpr = window.devicePixelRatio || 1;
  const INTERACTIVE_TAGS = new Set(["button","a","input","select","textarea","label"]);
  const nodes = [];
  const root = document.documentElement;
  if (!root) return { nodes };
  const stack = [{ el: root, depth: 0, parentRef: null }];

  while (stack.length && nodes.length < ${safeLimit}) {
    const cur = stack.pop();
    const el = cur.el;
    if (!el || el.nodeType !== 1) continue;

    const tag = (el.tagName || "").toLowerCase();
    const ref = "n" + String(nodes.length + 1);
    const id = el.id ? String(el.id) : undefined;
    const className = el.className ? String(el.className).slice(0, 300) : undefined;
    const role = el.getAttribute && el.getAttribute("role") ? String(el.getAttribute("role")) : undefined;
    const name = el.getAttribute && el.getAttribute("aria-label") ? String(el.getAttribute("aria-label")) : undefined;

    let isInteractive = INTERACTIVE_TAGS.has(tag);
    if (!isInteractive) {
      try {
        const style = window.getComputedStyle(el);
        if (style.cursor === "pointer" || el.onclick || el.getAttribute("onclick")) {
          isInteractive = true;
        }
      } catch {}
    }

    // Always compute boundingBox for all elements (needed for iframe offset calculation)
    let boundingBox = null;
    try {
      const rect = el.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        boundingBox = {
          x: Math.round(rect.left * dpr),
          y: Math.round(rect.top * dpr),
          width: Math.round(rect.width * dpr),
          height: Math.round(rect.height * dpr),
        };
      }
    } catch {}

    let text = "";
    try { text = String(el.innerText || "").trim(); } catch {}
    if (${safeText} && text.length > ${safeText}) text = text.slice(0, ${safeText}) + "…";
    const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
    const type = (el.type !== undefined && el.type !== null) ? String(el.type) : undefined;
    const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;

    nodes.push({
      ref, parentRef: cur.parentRef, depth: cur.depth, tag,
      ...(id ? { id } : {}),
      ...(className ? { className } : {}),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      ...(text ? { text } : {}),
      ...(href ? { href } : {}),
      ...(type ? { type } : {}),
      ...(value ? { value } : {}),
      ...(boundingBox ? { boundingBox } : {}),
    });

    const children = el.children ? Array.from(el.children) : [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ el: children[i], depth: cur.depth + 1, parentRef: ref });
    }
  }
  return { nodes };
})()
`;
}
