// src/viking/router.test.ts
import { describe, it, expect, vi } from "vitest";
import { VikingRouter } from "./router.js";
import type { RouteDecision } from "./types.js";

describe("VikingRouter", () => {
  it("routes file operation message correctly", async () => {
    const mockDecision: RouteDecision = {
      intent: "file_ops",
      requiredTools: ["fs_read"],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.92,
    };

    const mockClassify = vi.fn().mockResolvedValue(mockDecision);
    const mockApplyFilters = vi.fn().mockReturnValue({
      tools: ["fs_read"],
      files: [],
      skills: [],
      tokenSavingsPercent: 80,
    });

    const mockClassifier = { classify: mockClassify };
    const mockFilter = { applyFilters: mockApplyFilters };

    const router = new VikingRouter(mockClassifier as never, mockFilter as never);
    const result = await router.route("List files in Desktop");

    expect(result.decision.intent).toBe("file_ops");
    expect(result.filteredContext.tools).toContain("fs_read");
    expect(mockClassify).toHaveBeenCalledTimes(1);
  });

  it("applies context filtering after classification", async () => {
    const mockDecision: RouteDecision = {
      intent: "browser",
      requiredTools: ["browser_navigate"],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "normal",
      confidence: 0.88,
    };

    const mockClassify = vi.fn().mockResolvedValue(mockDecision);
    const mockApplyFilters = vi.fn().mockReturnValue({
      tools: ["browser_navigate"],
      files: [],
      skills: [],
      tokenSavingsPercent: 60,
    });

    const mockClassifier = { classify: mockClassify };
    const mockFilter = { applyFilters: mockApplyFilters };

    const router = new VikingRouter(mockClassifier as never, mockFilter as never);
    const availableContext = {
      tools: ["fs_read", "browser_navigate", "gui_click"],
      files: ["README.md"],
      skills: [],
    };

    await router.route("Open google.com", availableContext);

    expect(mockApplyFilters).toHaveBeenCalledTimes(1);
  });

  it("returns fallback decision on classification failure", async () => {
    const mockClassify = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const mockApplyFilters = vi.fn().mockReturnValue({
      tools: [],
      files: [],
      skills: [],
      tokenSavingsPercent: 0,
    });

    const mockClassifier = { classify: mockClassify };
    const mockFilter = { applyFilters: mockApplyFilters };

    const router = new VikingRouter(mockClassifier as never, mockFilter as never, {
      fallbackIntent: "chat",
    });
    const result = await router.route("Some message");

    expect(result.decision.intent).toBe("chat");
    expect(result.decision.confidence).toBeLessThan(0.5);
  });

  it("falls back when confidence is below threshold", async () => {
    // Inline factory so each call gets a fresh object — avoids mutation leakage
    const mockApplyFilters = vi.fn().mockReturnValue({
      tools: [],
      files: [],
      skills: [],
      tokenSavingsPercent: 0,
    });
    const mockFilter = { applyFilters: mockApplyFilters };
    const router = new VikingRouter(
      {
        classify: () =>
          Promise.resolve({
            intent: "browser",
            requiredTools: ["browser"],
            requiredFiles: [],
            requiredSkills: [],
            contextSizeHint: "normal" as const,
            confidence: 0.3,
          }),
      } as never,
      mockFilter as never,
      { fallbackIntent: "chat" },
    );
    const result = await router.routeWithThreshold("ambiguous request");
    expect(result.decision.intent).toBe("chat");
    expect(result.decision.confidence).toBe(0.1);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("confidence_below_threshold");
  });

  it("proceeds when confidence is at or above threshold", async () => {
    const mockApplyFilters = vi.fn().mockReturnValue({
      tools: ["fs_read"],
      files: [],
      skills: [],
      tokenSavingsPercent: 80,
    });
    const mockFilter = { applyFilters: mockApplyFilters };
    const router = new VikingRouter(
      {
        classify: () =>
          Promise.resolve({
            intent: "file_ops",
            requiredTools: ["fs_read"],
            requiredFiles: [],
            requiredSkills: [],
            contextSizeHint: "minimal" as const,
            confidence: 0.85,
          }),
      } as never,
      mockFilter as never,
      { fallbackIntent: "chat" },
    );
    const result = await router.routeWithThreshold("list files");
    expect(result.decision.intent).toBe("file_ops");
    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
