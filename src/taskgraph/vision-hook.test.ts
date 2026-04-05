// src/taskgraph/vision-hook.test.ts
import { describe, it, expect, vi } from "vitest";
import type { BrowserInterface, VisualContext } from "./browser-interface.js";
import type { Step } from "./types.js";
import { VisionVerificationHook } from "./vision-hook.js";

describe("VisionVerificationHook", () => {
  describe("verify() with VisualContext", () => {
    it("uses getVisualContext when available", async () => {
      const mockCtx: VisualContext = {
        screenshot: Buffer.from("fake-screenshot"),
        domSnapshot: "<html><body><button>OK</button></body></html>",
        capturedAt: Date.now(),
        stability: "stable",
      };

      const getContentMock = vi.fn().mockResolvedValue("<html><body>old</body></html>");
      const getScreenshotMock = vi.fn().mockResolvedValue(Buffer.from("old"));
      const getVisualContextMock = vi.fn().mockResolvedValue(mockCtx);

      const mockBrowser = {
        getContent: getContentMock,
        getScreenshot: getScreenshotMock,
        getVisualContext: getVisualContextMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: true });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "navigate",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "navigate", url: "https://example.com" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        "",
      );

      expect(getVisualContextMock).toHaveBeenCalled();
      expect(getContentMock).not.toHaveBeenCalled();
      expect(result.snapshotUsed).toBe(mockCtx.domSnapshot);
      expect(result.reason).toContain("stable");
    });

    it("falls back to getContent when getVisualContext is absent", async () => {
      const getContentMock = vi
        .fn()
        .mockResolvedValue("<html><body><button>OK</button></body></html>");
      const getScreenshotMock = vi.fn().mockResolvedValue(Buffer.from("fake"));

      const mockBrowser = {
        getContent: getContentMock,
        getScreenshot: getScreenshotMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: true });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "navigate",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "navigate", url: "https://example.com" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        "",
      );

      expect(getContentMock).toHaveBeenCalled();
      expect(result.snapshotUsed).toBe("<html><body><button>OK</button></body></html>");
    });

    it("reports stability status in reason", async () => {
      const mockCtx: VisualContext = {
        screenshot: Buffer.from("fake"),
        domSnapshot: "<html><body>partial</body></html>",
        capturedAt: Date.now(),
        stability: "timeout_partial",
      };

      const getVisualContextMock = vi.fn().mockResolvedValue(mockCtx);

      const mockBrowser = {
        getVisualContext: getVisualContextMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: true });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "wait",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "wait" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        "",
      );

      expect(result.reason).toContain("timeout_partial");
    });

    it("falls back when getVisualContext throws", async () => {
      const getContentMock = vi.fn().mockResolvedValue("<html><body>fallback</body></html>");
      const getScreenshotMock = vi.fn().mockResolvedValue(Buffer.from("fallback-img"));
      const getVisualContextMock = vi.fn().mockRejectedValue(new Error("CDP disconnected"));

      const mockBrowser = {
        getContent: getContentMock,
        getScreenshot: getScreenshotMock,
        getVisualContext: getVisualContextMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: true });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "click",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "click" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        "",
      );

      expect(getContentMock).toHaveBeenCalled();
      expect(result.snapshotUsed).toBe("<html><body>fallback</body></html>");
    });

    it("returns uncertain when disabled", async () => {
      const getContentMock = vi
        .fn()
        .mockResolvedValue("<html><body>should not be called</body></html>");
      const getScreenshotMock = vi.fn().mockResolvedValue(Buffer.from("should not be called"));

      const mockBrowser = {
        getContent: getContentMock,
        getScreenshot: getScreenshotMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: false });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "navigate",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "navigate", url: "https://example.com" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        "",
      );

      expect(result.status).toBe("uncertain");
      expect(result.reason).toContain("disabled");
      expect(getContentMock).not.toHaveBeenCalled();
    });

    it("includes screenshot size in reason when screenshot is present", async () => {
      const mockCtx: VisualContext = {
        screenshot: Buffer.from("x".repeat(2048)), // ~2KB
        domSnapshot: "<html><body>with screenshot</body></html>",
        capturedAt: Date.now(),
        stability: "stable",
      };

      const getVisualContextMock = vi.fn().mockResolvedValue(mockCtx);

      const mockBrowser = {
        getVisualContext: getVisualContextMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: true });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "wait",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "wait" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        "",
      );

      expect(result.reason).toContain("KB screenshot");
      expect(result.reason).toContain("VisualContext[stability=stable]");
    });

    it("uses domSnapshot parameter when provided and getVisualContext is absent", async () => {
      const preCaptured = "<html><body>pre-captured DOM</body></html>";
      const getContentMock = vi
        .fn()
        .mockResolvedValue("<html><body>should not be called</body></html>");
      const getScreenshotMock = vi.fn().mockResolvedValue(Buffer.from("fake"));

      const mockBrowser = {
        getContent: getContentMock,
        getScreenshot: getScreenshotMock,
      } as unknown as BrowserInterface;

      const hook = new VisionVerificationHook({ enabled: true });
      const result = await hook.verify(
        {
          id: "s1",
          type: "browser",
          desc: "navigate",
          dependsOn: [],
          timeoutMs: 30000,
          action: { action: "navigate", url: "https://example.com" },
        } as Step,
        { stepId: "s1", status: "success" },
        mockBrowser,
        preCaptured,
      );

      expect(getContentMock).not.toHaveBeenCalled();
      expect(result.snapshotUsed).toBe(preCaptured);
    });
  });

  describe("shouldTrigger()", () => {
    it("returns false when disabled", () => {
      const hook = new VisionVerificationHook({ enabled: false });
      const step = {
        id: "s1",
        type: "browser" as const,
        desc: "click",
        dependsOn: [],
        timeoutMs: 30000,
        action: { action: "click" },
      } as Step;

      expect(hook.shouldTrigger(step, 1)).toBe(false);
    });

    it("returns true for critical actions", () => {
      const hook = new VisionVerificationHook({ enabled: true, criticalActions: ["click"] });
      const step = {
        id: "s1",
        type: "browser" as const,
        desc: "click",
        dependsOn: [],
        timeoutMs: 30000,
        action: { action: "click" },
      } as Step;

      expect(hook.shouldTrigger(step, 0)).toBe(true);
    });

    it("returns false for non-critical actions at non-periodic intervals", () => {
      const hook = new VisionVerificationHook({ enabled: true, triggerEveryNSteps: 3 });
      const step = {
        id: "s1",
        type: "browser" as const,
        desc: "navigate",
        dependsOn: [],
        timeoutMs: 30000,
        action: { action: "navigate" },
      } as Step;

      expect(hook.shouldTrigger(step, 1)).toBe(false);
      expect(hook.shouldTrigger(step, 2)).toBe(false);
    });

    it("returns true at periodic intervals", () => {
      const hook = new VisionVerificationHook({ enabled: true, triggerEveryNSteps: 3 });
      const step = {
        id: "s1",
        type: "browser" as const,
        desc: "navigate",
        dependsOn: [],
        timeoutMs: 30000,
        action: { action: "navigate" },
      } as Step;

      expect(hook.shouldTrigger(step, 3)).toBe(true);
      expect(hook.shouldTrigger(step, 6)).toBe(true);
      expect(hook.shouldTrigger(step, 9)).toBe(true);
    });
  });
});
