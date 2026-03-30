// src/viking/router.test.ts
import { describe, it, expect, vi } from "vitest";
import { VikingRouter } from "./router";
import type { IntentClassifier } from "./intent-classifier";
import type { ContextFilter } from "./context-filter";
import type { RouteDecision } from "./types";

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

    const mockClassifier = {
      classify: vi.fn().mockResolvedValue(mockDecision),
    } as unknown as IntentClassifier;

    const mockFilter = {
      applyFilters: vi.fn().mockReturnValue({
        tools: ["fs_read"],
        files: [],
        skills: [],
        tokenSavingsPercent: 80,
      }),
    } as unknown as ContextFilter;

    const router = new VikingRouter(mockClassifier, mockFilter);
    const result = await router.route("List files in Desktop");

    expect(result.decision.intent).toBe("file_ops");
    expect(result.filteredContext.tools).toContain("fs_read");
    expect(mockClassifier.classify).toHaveBeenCalledWith("List files in Desktop");
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

    const mockClassifier = {
      classify: vi.fn().mockResolvedValue(mockDecision),
    } as unknown as IntentClassifier;

    const mockFilter = {
      applyFilters: vi.fn().mockReturnValue({
        tools: ["browser_navigate"],
        files: [],
        skills: [],
        tokenSavingsPercent: 60,
      }),
    } as unknown as ContextFilter;

    const router = new VikingRouter(mockClassifier, mockFilter);
    const availableContext = {
      tools: ["fs_read", "browser_navigate", "gui_click"],
      files: ["README.md"],
      skills: [],
    };

    await router.route("Open google.com", availableContext);

    expect(mockFilter.applyFilters).toHaveBeenCalledWith(availableContext, mockDecision);
  });

  it("returns fallback decision on classification failure", async () => {
    const mockClassifier = {
      classify: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    } as unknown as IntentClassifier;

    const mockFilter = {
      applyFilters: vi.fn().mockReturnValue({
        tools: [],
        files: [],
        skills: [],
        tokenSavingsPercent: 0,
      }),
    } as unknown as ContextFilter;

    const router = new VikingRouter(mockClassifier, mockFilter, { fallbackIntent: "chat" });
    const result = await router.route("Some message");

    expect(result.decision.intent).toBe("chat");
    expect(result.decision.confidence).toBeLessThan(0.5);
  });
});