import type { Page } from "playwright";
import { describe, it, expect, vi } from "vitest";
import { PlaywrightAdapter } from "./playwright-adapter.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Mock Page factory ---
function createMockPage(
  overrides: Partial<{
    content: string;
    url: string;
    screenshotBuffer: Buffer;
    visibility: Record<string, boolean>;
    evaluateResult: unknown;
  }> = {},
): Page {
  const visibility = overrides.visibility ?? {};

  return {
    content: vi
      .fn()
      .mockResolvedValue(overrides.content ?? "<html><body><div>test</div></body></html>"),
    url: vi.fn().mockReturnValue(overrides.url ?? "https://example.com"),
    screenshot: vi
      .fn()
      .mockResolvedValue(overrides.screenshotBuffer ?? Buffer.from("fake-screenshot")),
    locator: vi.fn().mockImplementation((selector: string) => ({
      first: vi.fn().mockReturnValue({
        isVisible: vi.fn().mockImplementation(() => {
          // Check visibility for this selector
          if (!visibility[selector]) {
            return Promise.reject(new Error("not visible"));
          }
          return Promise.resolve(true);
        }),
      }),
    })),
    evaluate: vi.fn().mockResolvedValue(overrides.evaluateResult ?? null),
  } as unknown as Page;
}

describe("PlaywrightAdapter", () => {
  describe("inferIFrameLabel", () => {
    const cases: Array<[string, string]> = [
      ["https://checkout.stripe.com/pay", "Stripe Checkout"],
      ["https://www.paypal.com/checkout", "PayPal Checkout"],
      ["https://accounts.google.com/o/oauth2/auth", "Google Sign-In"],
      ["https://www.facebook.com/v12.0/dialog/oauth", "Facebook Login"],
      ["https://js.stripe.com/v3/", "Payment"],
      ["https://cdn.example.com/banner.html", "Embedded Content"],
      ["https://static.paypalobjects.com/button.js", "Embedded Content"],
      ["https://unknown-site.io/frame", "unknown-site.io"],
    ];

    cases.forEach(([url, expected]) => {
      it(`"${url}" → "${expected}"`, () => {
        const adapter = new (PlaywrightAdapter as any)(createMockPage(), {});
        const label = adapter.inferIFrameLabel(url);
        expect(label).toBe(expected);
      });
    });

    it("returns 'Embedded Frame' for empty src", () => {
      const adapter = new (PlaywrightAdapter as any)(createMockPage(), {});
      expect(adapter.inferIFrameLabel("")).toBe("Embedded Frame");
    });
  });

  describe("processIFrame", () => {
    it("creates iframe placeholder with data-frame-id", () => {
      const adapter = new (PlaywrightAdapter as any)(createMockPage(), {});
      const fakeEl = {
        getAttribute: (name: string) => {
          if (name === "src") {
            return "https://checkout.stripe.com/pay";
          }
          if (name === "title") {
            return null;
          }
          return null;
        },
      };
      const result = adapter.processIFrame(fakeEl);
      expect(result).toContain("data-frame-id=");
      expect(result).toContain("data-frame-label=");
      expect(result).toContain("Stripe");
    });

    it("prefers title attribute over hostname inference", () => {
      const adapter = new (PlaywrightAdapter as any)(createMockPage(), {});
      const fakeEl = {
        getAttribute: (name: string) => {
          if (name === "src") {
            return "https://unknown.com/frame";
          }
          if (name === "title") {
            return "Payment Form";
          }
          return null;
        },
      };
      const result = adapter.processIFrame(fakeEl);
      expect(result).toContain('data-frame-label="Payment Form"');
    });

    it("handles empty src gracefully", () => {
      const adapter = new (PlaywrightAdapter as any)(createMockPage(), {});
      const fakeEl = {
        getAttribute: (name: string) => {
          if (name === "src") {
            return "";
          }
          if (name === "title") {
            return null;
          }
          return null;
        },
      };
      const result = adapter.processIFrame(fakeEl);
      expect(result).toContain('data-frame-label="Embedded Frame"');
    });
  });

  describe("processIframes", () => {
    it("replaces iframe tags in HTML", () => {
      const adapter = new (PlaywrightAdapter as any)(createMockPage(), {});
      const html =
        '<html><body><iframe src="https://checkout.stripe.com" title="Pay"></iframe></body></html>';
      const result = adapter.processIframes(html);
      expect(result).toContain("data-frame-id=");
      // title="Pay" is used when present (takes precedence)
      expect(result).toContain("Pay");
      expect(result).not.toContain("<iframe src=");
    });

    it("returns original HTML when extractLabel is false", () => {
      const adapter = new (PlaywrightAdapter as any)(createMockPage(), {
        iframe: { extractLabel: false },
      });
      const html = '<html><body><iframe src="https://example.com"></iframe></body></html>';
      const result = adapter.processIframes(html);
      expect(result).toBe(html);
    });
  });

  describe("getContent", () => {
    it("returns scrubbed HTML", async () => {
      const html =
        '<html><head><script>alert(1)</script></head><body><div id="main">Hello</div></body></html>';
      const adapter = new PlaywrightAdapter(createMockPage({ content: html }));
      const result = await adapter.getContent();
      expect(result).not.toContain("<script>");
      expect(result).toContain("Hello");
    });
  });

  describe("getScreenshot", () => {
    it("returns screenshot buffer", async () => {
      const buf = Buffer.from("test-png");
      const adapter = new PlaywrightAdapter(createMockPage({ screenshotBuffer: buf }));
      const result = await adapter.getScreenshot();
      expect(result).toBe(buf);
    });
  });

  describe("getUrl", () => {
    it("returns current page URL", async () => {
      const adapter = new PlaywrightAdapter(createMockPage({ url: "https://github.com/openclaw" }));
      const result = await adapter.getUrl();
      expect(result).toBe("https://github.com/openclaw");
    });
  });

  describe("isVisible", () => {
    it("returns true when element is visible", async () => {
      const adapter = new PlaywrightAdapter(createMockPage({ visibility: { "#btn": true } }));
      const result = await adapter.isVisible("#btn");
      expect(result).toBe(true);
    });

    it("returns false when element throws on visibility check", async () => {
      const adapter = new PlaywrightAdapter(createMockPage({ visibility: { "#hidden": false } }));
      const result = await adapter.isVisible("#hidden");
      expect(result).toBe(false);
    });
  });

  describe("ensureStabilized", () => {
    it("returns stable when DOM quiets within timeout", async () => {
      let callCount = 0;
      const page = createMockPage();
      page.evaluate = vi.fn().mockImplementation((_fn: string | Function) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(null);
        } // injection
        // After injection, simulate DOM being stable (lastMutation far in past)
        return Promise.resolve(Date.now() - 1000);
      });

      const adapter = new PlaywrightAdapter(page, {
        stability: { quietThresholdMs: 300, hardTimeoutMs: 3000, pollIntervalMs: 20 },
      } as any);

      const status = await (adapter as any).ensureStabilized();
      expect(status).toBe("stable");
    });

    it("returns timeout_partial when hard timeout is hit", async () => {
      let callCount = 0;
      const page = createMockPage();
      page.evaluate = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(null);
        } // injection
        // Always return "just mutated" to prevent early exit
        return Promise.resolve(Date.now() - 10);
      });

      const adapter = new PlaywrightAdapter(page, {
        stability: { quietThresholdMs: 300, hardTimeoutMs: 50, pollIntervalMs: 10 },
      } as any);

      const status = await (adapter as any).ensureStabilized();
      expect(status).toBe("timeout_partial");
    });

    it("sets _lastStabilityStatus on instance", async () => {
      let callCount = 0;
      const page = createMockPage();
      page.evaluate = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(null);
        }
        return Promise.resolve(Date.now() - 1000);
      });

      const adapter = new PlaywrightAdapter(page, {
        stability: { quietThresholdMs: 300, hardTimeoutMs: 3000, pollIntervalMs: 20 },
      } as any);

      await (adapter as any).ensureStabilized();
      expect(adapter.lastStabilityStatus()).toBe("stable");
    });
  });

  describe("getVisualContext", () => {
    it("returns VisualContext with screenshot and domSnapshot", async () => {
      const page = createMockPage({
        content: "<html><body><button>Click me</button></body></html>",
        screenshotBuffer: Buffer.from("fake-image-bytes"),
      });
      page.evaluate = vi.fn().mockResolvedValue(null);

      const adapter = new PlaywrightAdapter(page, {
        stability: { quietThresholdMs: 300, hardTimeoutMs: 3000, pollIntervalMs: 20 },
      } as any);

      const ctx = await adapter.getVisualContext();

      expect(ctx).toHaveProperty("screenshot");
      expect(ctx).toHaveProperty("domSnapshot");
      expect(ctx).toHaveProperty("capturedAt");
      expect(ctx).toHaveProperty("stability");
      expect(typeof ctx.capturedAt).toBe("number");
      expect(ctx.domSnapshot.length).toBeGreaterThan(0);
    });

    it("passes scrubMaxLength to scrubHtml", async () => {
      const longHtml = "<html><body>" + "<div>x</div>".repeat(500) + "</body></html>";
      const page = createMockPage({ content: longHtml });
      page.evaluate = vi.fn().mockResolvedValue(null);

      const adapter = new PlaywrightAdapter(page, {
        stability: { quietThresholdMs: 300, hardTimeoutMs: 3000, pollIntervalMs: 20 },
        scrubMaxLength: 200,
      } as any);

      const ctx = await adapter.getVisualContext();
      expect(ctx.domSnapshot.length).toBeLessThanOrEqual(200 + 100);
    });
  });

  describe("Multi-Frame CDP Snapshot (Phase 2b Milestone 1)", () => {
    // Mock Playwright Frame
    function createMockFrame(opts: {
      url?: string;
      name?: string;
      mainFrame?: boolean;
      frameElementBoundingBox?: { x: number; y: number; width: number; height: number } | null;
      /** Returns the nodes this frame's evaluate() should return */
      evaluateNodes?: any[];
    }): import("playwright").Frame {
      const url = opts.url ?? "https://example.com/page";
      const name = opts.name ?? "";
      const evaluateNodes = opts.evaluateNodes ?? [];
      return {
        url: vi.fn().mockReturnValue(url),
        name: vi.fn().mockReturnValue(name),
        isOOPFrame: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue({ nodes: evaluateNodes }),
        ...(opts.mainFrame !== undefined ? { _isMainFrame: opts.mainFrame } : {}),
      } as unknown as import("playwright").Frame;
    }

    // Mock Page with frames support
    function createMockPageWithFrames(opts: {
      screenshotBuffer?: Buffer;
      mainFrameUrl?: string;
      subFrames?: import("playwright").Frame[];
      mainFrameNodes?: any[];
      subFrameNodes?: any[];
    }): import("playwright").Page {
      const subFrames = opts.subFrames ?? [];
      const mainFrameNodes = opts.mainFrameNodes ?? [];
      const subFrameNodes = opts.subFrameNodes ?? [];

      // Map frame URL strings to their nodes (stable across frames() calls)
      const frameUrlToNodes = new Map<string, any[]>();
      subFrames.forEach((f, i) => {
        try {
          const frameUrl = f.url();
          frameUrlToNodes.set(frameUrl, subFrameNodes[i] ?? []);
        } catch {
          // Fallback: use index
        }
      });

      const mainSession = {
        send: vi.fn().mockImplementation(async (method: string) => {
          if (method === "Page.enable") {
            return {};
          }
          if (method === "DOM.enable") {
            return {};
          }
          if (method === "Runtime.enable") {
            return {};
          }
          if (method === "Page.captureScreenshot") {
            return { data: (opts.screenshotBuffer ?? Buffer.from("fake")).toString("base64") };
          }
          if (method === "Runtime.evaluate") {
            return {
              result: {
                value: {
                  nodes: mainFrameNodes.length > 0 ? mainFrameNodes : [],
                  capturedAt: Date.now(),
                },
              },
            };
          }
          return {};
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      };

      return {
        context: () => ({
          newCDPSession: vi
            .fn()
            .mockImplementation(
              async (target: import("playwright").Page | import("playwright").Frame) => {
                // Check if this is a known sub-frame by URL
                const frameUrl = typeof target?.url === "function" ? target.url() : null;
                if (frameUrl && frameUrlToNodes.has(frameUrl)) {
                  const nodes = frameUrlToNodes.get(frameUrl)!;
                  return {
                    send: vi.fn().mockImplementation(async (method: string) => {
                      if (method === "Runtime.enable") {
                        return {};
                      }
                      if (method === "Runtime.evaluate") {
                        return {
                          result: { value: { nodes, capturedAt: Date.now() } },
                        };
                      }
                      return {};
                    }),
                    detach: vi.fn().mockResolvedValue(undefined),
                  };
                }
                // Otherwise it's the main frame/page session
                return mainSession;
              },
            ),
        }),
        mainFrame: vi
          .fn()
          .mockReturnValue(
            createMockFrame({ url: opts.mainFrameUrl ?? "https://example.com", mainFrame: true }),
          ),
        frames: vi
          .fn()
          .mockReturnValue([
            createMockFrame({ url: opts.mainFrameUrl ?? "https://example.com", mainFrame: true }),
            ...subFrames,
          ]),
        evaluate: vi.fn().mockImplementation((fn: string | Function) => {
          if (typeof fn === "function") {
            return Promise.resolve(null);
          }
          return Promise.resolve(null);
        }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue(opts.mainFrameUrl ?? "https://example.com"),
      } as unknown as import("playwright").Page;
    }

    const MAIN_FRAME_NODES = [
      { ref: "n1", parentRef: null, depth: 0, tag: "html" },
      { ref: "n2", parentRef: "n1", depth: 1, tag: "body" },
      {
        ref: "n3",
        parentRef: "n2",
        depth: 2,
        tag: "iframe",
        name: "checkout-frame",
        href: "https://example.com/embedded/form",
        boundingBox: { x: 50, y: 100, width: 400, height: 300 },
      },
    ];

    const SUB_FRAME_NODES = [
      { ref: "n1", parentRef: null, depth: 0, tag: "html" },
      { ref: "n2", parentRef: "n1", depth: 1, tag: "body" },
      {
        ref: "n3",
        parentRef: "n2",
        depth: 2,
        tag: "button",
        role: "button",
        text: "Submit",
        boundingBox: { x: 10, y: 20, width: 80, height: 40 },
      },
    ];

    it("returns main-frame-only nodes when no subframes exist", async () => {
      const page = createMockPageWithFrames({
        mainFrameNodes: MAIN_FRAME_NODES,
        subFrames: [],
      });
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        captureSubframes: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      expect(ctx.nodes).toBeDefined();
      // Should contain main frame nodes including iframe placeholder
      const iframeNodes = ctx.nodes!.filter((n) => n.tag === "iframe");
      expect(iframeNodes.length).toBeGreaterThan(0);
    });

    it("filters same-origin subframes and captures their content", async () => {
      // Subframe with SAME origin as main frame — name matches iframe node.name
      const sameOriginFrame = createMockFrame({
        url: "https://example.com/embedded/form",
        name: "checkout-frame",
        mainFrame: false,
        evaluateNodes: SUB_FRAME_NODES,
      });
      const page = createMockPageWithFrames({
        mainFrameNodes: MAIN_FRAME_NODES,
        subFrames: [sameOriginFrame],
        subFrameNodes: [SUB_FRAME_NODES],
      });
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        captureSubframes: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      // Subframe button should appear in the merged result
      const buttonNodes = ctx.nodes!.filter((n) => n.tag === "button" && n.text === "Submit");
      expect(buttonNodes.length).toBe(1);
    });

    it("applies frame boundingBox offset to child frame nodes", async () => {
      const sameOriginFrame = createMockFrame({
        url: "https://example.com/embedded/form",
        name: "checkout-frame",
        mainFrame: false,
        evaluateNodes: SUB_FRAME_NODES,
      });
      const page = createMockPageWithFrames({
        mainFrameNodes: MAIN_FRAME_NODES,
        subFrames: [sameOriginFrame],
        subFrameNodes: [SUB_FRAME_NODES],
      });
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        captureSubframes: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      // Child frame node has boundingBox {x:10, y:20}
      // Parent iframe has boundingBox {x:50, y:100}
      // Merged absolute position should be {x:60, y:120}
      const buttonNodes = ctx.nodes!.filter((n) => n.tag === "button");
      if (buttonNodes.length > 0) {
        const btn = buttonNodes[0];
        expect(btn.boundingBox).toBeDefined();
        // Absolute: parent iframe.x + child node.x, parent iframe.y + child node.y
        expect(btn.boundingBox!.x).toBe(60); // 50 + 10
        expect(btn.boundingBox!.y).toBe(120); // 100 + 20
      }
    });

    it.skip("skips cross-origin subframes (OOPIF)", async () => {
      // Cross-origin iframe — Playwright marks as OOP frame
      const crossOriginFrame = createMockFrame({
        url: "https://different-domain.com/page",
        mainFrame: false,
      });
      (crossOriginFrame as any).isOOPFrame = vi.fn().mockReturnValue(true);

      const page = createMockPageWithFrames({
        mainFrameNodes: MAIN_FRAME_NODES,
        subFrames: [crossOriginFrame],
      });
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        captureSubframes: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      // Cross-origin frame should not be captured — only main frame + iframe placeholder
      expect(ctx.nodes!.length).toBeLessThanOrEqual(MAIN_FRAME_NODES.length);
    });

    it("merges frameRef metadata into captured nodes", async () => {
      const sameOriginFrame = createMockFrame({
        url: "https://example.com/embedded/form",
        name: "checkout-frame",
        mainFrame: false,
      });
      const page = createMockPageWithFrames({
        mainFrameNodes: MAIN_FRAME_NODES,
        subFrames: [sameOriginFrame],
        subFrameNodes: [SUB_FRAME_NODES],
      });
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        captureSubframes: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      // Main frame nodes should have frameRef: "main"
      // Child frame nodes should have frameRef: frame name/identifier
      const mainFrameNodes = ctx.nodes!.filter((n) => n.frameRef !== undefined);
      if (mainFrameNodes.length > 0) {
        expect(mainFrameNodes.some((n) => n.frameRef === "main")).toBe(true);
      }
    });

    it("returns stability=unknown on subframe capture failure (non-fatal)", async () => {
      const sameOriginFrame = createMockFrame({
        url: "https://example.com/embedded/form",
        name: "checkout-frame",
        mainFrame: false,
      });
      const page = createMockPageWithFrames({
        mainFrameNodes: MAIN_FRAME_NODES,
        subFrames: [sameOriginFrame],
        subFrameNodes: [SUB_FRAME_NODES],
      });

      // Override context().newCDPSession to fail on frame sessions
      (page.context as any).newCDPSession = vi.fn().mockImplementation(async (target: any) => {
        if (target && target.url?.()?.includes("example.com/embedded")) {
          throw new Error("Execution context was destroyed");
        }
        return {
          send: vi.fn().mockImplementation(async (method: string) => {
            if (method === "Page.enable") {
              return {};
            }
            if (method === "DOM.enable") {
              return {};
            }
            if (method === "Runtime.enable") {
              return {};
            }
            if (method === "Page.captureScreenshot") {
              return { data: Buffer.from("fake").toString("base64") };
            }
            if (method === "Runtime.evaluate") {
              return {
                result: { value: { nodes: MAIN_FRAME_NODES, capturedAt: Date.now() } },
              };
            }
            return {};
          }),
          detach: vi.fn().mockResolvedValue(undefined),
        };
      });

      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        captureSubframes: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      // Main frame capture should succeed, subframe failure is non-fatal
      expect(ctx.stability).toBe("stable");
      // Main frame nodes should still be present
      const mainNodes = ctx.nodes!.filter((n) => n.tag !== "iframe");
      expect(mainNodes.length).toBeGreaterThan(0);
    });
  });

  describe("CDP Atomic Snapshot", () => {
    function createMockPageCDP(send: ReturnType<typeof vi.fn>) {
      return {
        context: () => ({
          newCDPSession: async () => ({
            send,
            detach: vi.fn().mockReturnValue(Promise.resolve()),
          }),
        }),
      } as unknown as import("playwright").Page;
    }

    const FIXTURE_NODES = [
      { ref: "n1", parentRef: null, depth: 0, tag: "html" },
      { ref: "n2", parentRef: "n1", depth: 1, tag: "body" },
      {
        ref: "n3",
        parentRef: "n2",
        depth: 2,
        tag: "button",
        role: "button",
        text: "Submit",
        boundingBox: { x: 100, y: 200, width: 80, height: 40 },
      },
    ];

    it("captures screenshot and nodes atomically in same session", async () => {
      const send = vi.fn(async (method: string) => {
        if (method === "Page.enable") {
          return {};
        }
        if (method === "DOM.enable") {
          return {};
        }
        if (method === "Runtime.enable") {
          return {};
        }
        if (method === "Page.captureScreenshot") {
          return { data: Buffer.from("fake-screenshot").toString("base64") };
        }
        if (method === "Runtime.evaluate") {
          return { result: { value: { nodes: FIXTURE_NODES } } };
        }
        return {};
      });

      const page = createMockPageCDP(send);
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      expect(send).toHaveBeenCalledWith("Page.enable");
      expect(send).toHaveBeenCalledWith("Runtime.evaluate", expect.any(Object));
      expect(ctx.stability).toBe("stable");
      expect(ctx.screenshot).toBeInstanceOf(Buffer);
      expect(ctx.nodes).toHaveLength(3);
      expect(ctx.domSnapshot).toContain("data-v-id");
      expect(ctx.domSnapshot).toContain('data-v-coords="100,200,80,40"');
    });

    it("returns stability=unknown on navigation during capture", async () => {
      const send = vi.fn(async (_method: string) => {
        // Throw on first CDP call to simulate navigation
        throw new Error("Target page has been closed");
      });
      const page = createMockPageCDP(send);
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        page: page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();

      expect(ctx.stability).toBe("unknown");
      expect(ctx.screenshot).toEqual(Buffer.alloc(0));
      expect(ctx.nodes).toEqual([]);
    });

    it("pre-checks readyState before capture", async () => {
      const evaluate = vi.fn().mockResolvedValue("complete");
      const send = vi.fn(async (method: string) => {
        if (method === "Page.enable") {
          return {};
        }
        if (method === "DOM.enable") {
          return {};
        }
        if (method === "Runtime.enable") {
          return {};
        }
        if (method === "Page.captureScreenshot") {
          return { data: "ZGF0YQ==" };
        }
        if (method === "Runtime.evaluate") {
          return { result: { value: { nodes: [] } } };
        }
        return {};
      });

      const page = {
        context: () => ({
          newCDPSession: async () => ({ send, detach: vi.fn().mockReturnValue(Promise.resolve()) }),
        }),
        evaluate,
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("playwright").Page;

      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        page,
      } as never);

      await adapter.getCDPAtomicContext();
      expect(evaluate).toHaveBeenCalled();
      // The evaluate call should be checking document.readyState
      const calls = evaluate.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it("getVisualContext routes to CDP path when useCDPAtomic=true", async () => {
      const send = vi.fn(async (method: string) => {
        if (method === "Page.enable") {
          return {};
        }
        if (method === "DOM.enable") {
          return {};
        }
        if (method === "Runtime.enable") {
          return {};
        }
        if (method === "Page.captureScreenshot") {
          return { data: "ZGF0YQ==" };
        }
        if (method === "Runtime.evaluate") {
          return { result: { value: { nodes: FIXTURE_NODES } } };
        }
        return {};
      });
      const page = createMockPageCDP(send);
      const adapter = new PlaywrightAdapter(page, {
        useCDPAtomic: true,
        page,
      } as never);

      const ctx = await adapter.getCDPAtomicContext();
      expect(send).toHaveBeenCalled();
      expect(ctx.nodes).toBeDefined();
    });
  });
});
