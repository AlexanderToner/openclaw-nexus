// src/viking/intent-classifier.test.ts
import { describe, it, expect, vi } from "vitest";
import { IntentClassifier } from "./intent-classifier";
import type { RouteDecision } from "./types";

describe("IntentClassifier", () => {
  it("classifies file operation intent", async () => {
    const mockDecision: RouteDecision = {
      intent: "file_ops",
      requiredTools: ["fs_read", "fs_write"],
      requiredFiles: ["AGENTS.md#section-3"],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.92,
    };

    const mockLlm = vi.fn().mockResolvedValue(mockDecision);
    const classifier = new IntentClassifier(mockLlm);

    const result = await classifier.classify("Read the AGENTS.md file and find section 3");

    expect(result.intent).toBe("file_ops");
    expect(result.requiredTools).toContain("fs_read");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(mockLlm).toHaveBeenCalledTimes(1);
  });

  it("classifies GUI automation intent", async () => {
    const mockDecision: RouteDecision = {
      intent: "gui_auto",
      requiredTools: ["gui_click", "gui_type"],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "normal",
      confidence: 0.88,
    };

    const mockLlm = vi.fn().mockResolvedValue(mockDecision);
    const classifier = new IntentClassifier(mockLlm);

    const result = await classifier.classify("Click the submit button in the browser");

    expect(result.intent).toBe("gui_auto");
    expect(result.requiredTools).toContain("gui_click");
  });

  it("classifies browser automation intent", async () => {
    const mockDecision: RouteDecision = {
      intent: "browser",
      requiredTools: ["browser_navigate", "browser_click"],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "normal",
      confidence: 0.95,
    };

    const mockLlm = vi.fn().mockResolvedValue(mockDecision);
    const classifier = new IntentClassifier(mockLlm);

    const result = await classifier.classify("Open github.com and search for openclaw");

    expect(result.intent).toBe("browser");
  });

  it("classifies chat intent for simple questions", async () => {
    const mockDecision: RouteDecision = {
      intent: "chat",
      requiredTools: [],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.97,
    };

    const mockLlm = vi.fn().mockResolvedValue(mockDecision);
    const classifier = new IntentClassifier(mockLlm);

    const result = await classifier.classify("What is the capital of France?");

    expect(result.intent).toBe("chat");
    expect(result.contextSizeHint).toBe("minimal");
  });

  it("passes context size hint in prompt", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      intent: "chat",
      requiredTools: [],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.9,
    });

    const classifier = new IntentClassifier(mockLlm);
    await classifier.classify("Test message");

    const promptArg = mockLlm.mock.calls[0][0];
    expect(promptArg).toContain("Test message");
    expect(promptArg).toContain("intent");
    expect(promptArg).toContain("requiredTools");
  });
});