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
