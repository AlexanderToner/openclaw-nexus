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
});
