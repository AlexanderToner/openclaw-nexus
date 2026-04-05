/**
 * Phase 2b Milestone 1 — Real Browser Verification Script
 *
 * Launches a real Chromium instance, navigates to a page with same-origin and
 * cross-origin iframes, and calls captureMultiFrameAtomic() to observe real behavior.
 *
 * Run: bun scripts/debug-cdp-multi-frame.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, curly */

import { chromium, type Page } from "playwright-core";

// Inline the capture logic (imports from dist would require a build step)
async function withCDPAtomicSnapshot<T>(
  page: Page,
  fn: (send: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Page.enable");
    await session.send("DOM.enable");
    await session.send("Runtime.enable").catch(() => {});
    return await fn(async (method, params) => session.send(method, params) as Promise<unknown>);
  } finally {
    await session.detach().catch(() => {});
  }
}

const SNAPSHOT_DOM_EXPRESSION = (limit: number, maxTextChars: number): string => {
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

async function captureMultiFrameAtomic(
  page: Page,
  cdpSessions: Map<string, import("playwright-core").CDPSession>,
  context: import("playwright-core").BrowserContext,
): Promise<{
  page: Page;
  frames: Array<{ name: string; url: string; isOOP: boolean; nodeCount: number }>;
  mainScreenshotMs: number;
  totalMs: number;
}> {
  const allFrames = page.frames();
  const mainFrame = page.mainFrame();

  console.log(`\n[CDP Multi-Frame] page.frames() returned ${allFrames.length} frames:`);
  for (const f of allFrames) {
    const url = f.url();
    const name = f.name() || "(unnamed)";
    let isOOP = false;
    try {
      isOOP = (f as unknown as { isOOPFrame?: () => boolean }).isOOPFrame?.() ?? false;
    } catch {}
    console.log(`  - "${name}" | ${url.slice(0, 80)} | OOP=${isOOP}`);
  }

  const totalStart = performance.now();

  // Main frame atomic capture
  const mainStart = performance.now();
  const mainResult = await withCDPAtomicSnapshot(page, async (send) => {
    const screenshotResult = await send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 60,
      fromSurface: true,
      captureBeyondViewport: true,
    });
    const nodesResult = await send("Runtime.evaluate", {
      expression: SNAPSHOT_DOM_EXPRESSION(800, 220),
      returnByValue: true,
      awaitPromise: true,
    });
    return { screenshotResult, nodesResult };
  });
  const mainScreenshotMs = performance.now() - mainStart;

  // Parse main nodes
  const value = (mainResult.nodesResult as { result?: { value?: unknown } })?.result?.value as
    | { nodes?: unknown }
    | undefined;
  const mainNodes: unknown[] = value?.nodes ?? [];
  console.log(
    `\n[Main Frame] ${mainNodes.length} nodes captured in ${mainScreenshotMs.toFixed(1)}ms`,
  );

  const frameResults: Array<{
    name: string;
    url: string;
    isOOP: boolean;
    nodeCount: number;
    ms: number;
    error?: string;
  }> = [];

  for (const frame of allFrames) {
    if (frame === mainFrame) {
      continue;
    }

    const frameName = frame.name() || "(unnamed)";
    const frameUrl = frame.url();
    let isOOP = false;
    try {
      isOOP = (frame as unknown as { isOOPFrame?: () => boolean }).isOOPFrame?.() ?? false;
    } catch {
      /* isOOP remains false */
    }

    console.log(
      `\n[Sub-Frame] Testing: "${frameName}" | OOP=${isOOP} | URL=${frameUrl.slice(0, 80)}`,
    );

    const frameStart = performance.now();
    const preAttached = cdpSessions.get(frameName);
    let frameNodes: any[] = [];
    let methodUsed = "none";

    // ── Method 1: Try pre-attached CDP session ──────────────────────────────
    if (preAttached) {
      try {
        await preAttached.send("Runtime.enable").catch(() => {});
        const nodesResult = await preAttached.send("Runtime.evaluate", {
          expression: SNAPSHOT_DOM_EXPRESSION(800, 220),
          returnByValue: true,
          awaitPromise: true,
        });
        frameNodes = (nodesResult as any)?.result?.value?.nodes ?? [];
        methodUsed = "CDP-preattached";
      } catch {}
    }

    // ── Method 2: Try frame.evaluate() — works for ALL same-origin iframes ──
    if (frameNodes.length === 0) {
      try {
        const evalResult = await frame.evaluate(SNAPSHOT_DOM_EXPRESSION(800, 220));
        frameNodes = evalResult?.nodes ?? [];
        methodUsed = "frame.evaluate()";
      } catch (err) {
        // frame.evaluate() fails for OOPIFs — that's expected for Milestone 2
      }
    }

    // ── Method 3: Try creating CDP session on demand ────────────────────────
    // (Fails for same-origin unless auto-attach was enabled before navigation)
    if (frameNodes.length === 0) {
      try {
        const session = await context.newCDPSession(frame);
        await session.send("Runtime.enable").catch(() => {});
        const nodesResult = await session.send("Runtime.evaluate", {
          expression: SNAPSHOT_DOM_EXPRESSION(800, 220),
          returnByValue: true,
          awaitPromise: true,
        });
        frameNodes = (nodesResult as any)?.result?.value?.nodes ?? [];
        methodUsed = "CDP-on-demand";
        await session.detach().catch(() => {});
      } catch {
        // Expected for same-origin without pre-attach
      }
    }

    const frameMs = performance.now() - frameStart;
    if (frameNodes.length > 0) {
      frameResults.push({
        name: frameName,
        url: frameUrl,
        isOOP,
        nodeCount: frameNodes.length,
        ms: frameMs,
      });
      console.log(
        `  ✓ SUCCESS: ${frameNodes.length} nodes in ${frameMs.toFixed(1)}ms [method: ${methodUsed}]`,
      );
    } else {
      frameResults.push({
        name: frameName,
        url: frameUrl,
        isOOP,
        nodeCount: 0,
        ms: frameMs,
        error: "all methods failed",
      });
      console.log(
        `  ✗ FAILED: all capture methods failed (${frameMs.toFixed(1)}ms) [tried: CDP-preattached=${!!preAttached}, frame.evaluate, CDP-on-demand]`,
      );
    }
  }

  const totalMs = performance.now() - totalStart;

  return {
    frames: frameResults.map((r) => ({
      name: r.name,
      url: r.url,
      isOOP: r.isOOP,
      nodeCount: r.nodeCount,
    })),
    mainScreenshotMs,
    totalMs,
  };
}

// ── Test Page HTML ─────────────────────────────────────────────────────────

const TEST_PAGE_SAME_ORIGIN = (iframeName: string, buttonText: string) => `
<!DOCTYPE html>
<html>
<head><title>Same-Origin IFrame Test</title></head>
<body style="margin: 20px; font-family: sans-serif;">
  <h1>Main Page Context</h1>
  <p>This is the <strong>main frame</strong>.</p>
  <div id="main-trigger" style="width: 100px; height: 50px; background: blue; cursor: pointer;"></div>
  <p style="margin-top: 20px;">IFrame below (same origin, srcdoc):</p>
  <iframe
    id="same-origin-frame"
    name="${iframeName}"
    srcdoc='<!DOCTYPE html><html><body style="margin:10px; background:#f0f0f0;">
      <h3>Same-Origin IFrame Context</h3>
      <button id="iframe-btn" style="padding:10px; font-size:16px;">${buttonText}</button>
    </body></html>'
    style="width:300px; height:150px; border:1px solid black; margin-top:10px;">
  </iframe>
</body>
</html>
`;

const TEST_PAGE_CROSS_ORIGIN = `
<!DOCTYPE html>
<html>
<head><title>Cross-Origin IFrame Test</title></head>
<body style="margin: 20px; font-family: sans-serif;">
  <h1>Main Page (http://localhost)</h1>
  <p>This is the <strong>main frame</strong>.</p>
  <div id="main-trigger" style="width: 100px; height: 50px; background: green;"></div>
  <p style="margin-top: 20px;">IFrame below (cross-origin, data: URL):</p>
  <iframe
    id="cross-origin-frame"
    name="cross-frame"
    srcdoc='<!DOCTYPE html><html><body style="margin:10px; background:#ffe0e0;">
      <h3>Cross-Origin IFrame Context</h3>
      <button id="iframe-btn" style="padding:10px; font-size:16px;">I am in a different origin</button>
    </body></html>'
    style="width:300px; height:150px; border:1px solid red; margin-top:10px;">
  </iframe>
</body>
</html>
`;

// ── Test Runner ─────────────────────────────────────────────────────────────

async function runTest(name: string, html: string): Promise<void> {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`TEST: ${name}`);
  console.log("═".repeat(70));

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const context = await browser.newContext();

    // ── Enable auto-attach for same-origin iframes ──────────────────────────
    // By default, Playwright shares the parent's CDP session with same-origin
    // iframes. Calling context.on('frame', ...) before navigation causes Playwright
    // to create a separate CDP session for each frame (including same-origin ones).
    // Without this, page.context().newCDPSession(sameOriginFrame) throws:
    // "This frame does not have a separate CDP session"
    const frameSessionMap = new Map<string, import("playwright-core").CDPSession>();
    context.on("frame", async (frame) => {
      await page.waitForTimeout(50); // let Playwright finish attaching
      try {
        const session = await context.newCDPSession(frame);
        frameSessionMap.set(frame.name() || frame.url(), session);
      } catch {
        // cross-origin frames may fail here — that's expected
      }
    });

    const page = await context.newPage();

    // Navigate to data: URL
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await page.waitForLoadState("domcontentloaded");

    // Wait for iframes + auto-attach to settle
    await page.waitForTimeout(800);

    // ── Re-probe: check if auto-attach gave us sessions ─────────────────────
    console.log(`\n[Auto-Attach Probe] Pre-attached sessions:`);
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const key = f.name() || f.url();
      const hasSession = frameSessionMap.has(key);
      console.log(
        `  "${key}": ${hasSession ? "CDP session available" : "NO session (fallback to frame.evaluate())"}`,
      );
    }

    const result = await captureMultiFrameAtomic(page, frameSessionMap, context);

    console.log(`\n[SUMMARY] Main frame: ${result.mainScreenshotMs.toFixed(1)}ms`);
    console.log(`[SUMMARY] Total capture: ${result.totalMs.toFixed(1)}ms`);
    console.log(`[SUMMARY] Sub-frames tested: ${result.frames.length}`);
    for (const f of result.frames) {
      const status = f.nodeCount > 0 ? "✓" : "✗";
      console.log(`  ${status} "${f.name}" OOP=${f.isOOP} → ${f.nodeCount} nodes`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("Phase 2b Milestone 1 — Real Browser CDP Multi-Frame Verification");
  console.log("Browser: Chromium (headless)");
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Test 1: Same-origin iframe (srcdoc)
  await runTest("Same-Origin IFrame (srcdoc)", TEST_PAGE_SAME_ORIGIN("checkout-frame", "Pay Now"));

  // Test 2: srcdoc iframe (same-origin in Chromium despite being named "cross-origin")
  await runTest("Cross-Origin IFrame (data: URL)", TEST_PAGE_CROSS_ORIGIN);

  // Test 3: Real OOPIF — localhost:port1 vs localhost:port2 (different origins)
  // Uses Bun's built-in HTTP server
  let subPort = 0;
  const subServer = Bun.serve({
    port: 0, // pick available port
    fetch(req) {
      void req;
      return new Response(
        `<!DOCTYPE html><html><body style="margin:10px; background:#ffe0e0;">
          <h3>OOPIF Context (port ${subPort})</h3>
          <button id="iframe-btn" style="padding:10px; font-size:16px;">OOPIF Button</button>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  subPort = subServer.port;
  let mainPort = 0;
  const mainServer = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        `<!DOCTYPE html>
        <html><body style="margin:20px;">
          <h1>Main Page (port ${mainPort})</h1>
          <p>OOPIF test (different ports = different origins)</p>
          <iframe name="oopif-frame" src="http://localhost:${subServer.port}/"
            style="width:300px;height:150px;border:2px solid red;"></iframe>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  mainPort = mainServer.port;
  try {
    console.log(
      `\n[OOPIF Test] Main: http://localhost:${mainServer.port}/  Sub: http://localhost:${subServer.port}/`,
    );
    const browser = await chromium.launch({
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const frameSessionMap = new Map<string, import("playwright-core").CDPSession>();
    context.on("frame", async (frame) => {
      await page.waitForTimeout(50);
      try {
        const session = await context.newCDPSession(frame);
        frameSessionMap.set(frame.name() || frame.url(), session);
      } catch {}
    });
    await page.goto(`http://localhost:${mainServer.port}/`);
    await page.waitForTimeout(1000);

    console.log(`\n[OOPIF Frames]:`);
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const key = f.name() || f.url();
      const hasSession = frameSessionMap.has(key);
      console.log(`  "${key}": ${hasSession ? "CDP session" : "NO session"}`);
    }

    const result = await captureMultiFrameAtomic(page, frameSessionMap, context);
    console.log(`\n[SUMMARY] Sub-frames: ${result.frames.length}`);
    for (const f of result.frames) {
      const status = f.nodeCount > 0 ? "✓" : "✗";
      console.log(
        `  ${status} "${f.name}" OOP=${f.isOOP} → ${f.nodeCount} nodes (${f.ms?.toFixed(1)}ms)`,
      );
    }
    await browser.close();
  } finally {
    void subServer.stop();
    void mainServer.stop();
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("All tests complete.");
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
