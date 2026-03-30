// src/viking/context-filter.test.ts
import { describe, it, expect } from "vitest";
import { ContextFilter } from "./context-filter";
import type { RouteDecision } from "./types";

describe("ContextFilter", () => {
  it("filters tools based on RouteDecision", () => {
    const filter = new ContextFilter();
    const allTools = [
      "fs_read",
      "fs_write",
      "shell_exec",
      "browser_navigate",
      "gui_click",
      "slack_send",
    ];
    const decision: RouteDecision = {
      intent: "file_ops",
      requiredTools: ["fs_read", "fs_write"],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.9,
    };

    const result = filter.filterTools(allTools, decision);

    expect(result.filtered).toEqual(["fs_read", "fs_write"]);
    expect(result.filteredOut).toEqual(["shell_exec", "browser_navigate", "gui_click", "slack_send"]);
  });

  it("returns all tools when contextSizeHint is full", () => {
    const filter = new ContextFilter();
    const allTools = ["fs_read", "shell_exec", "browser_navigate"];
    const decision: RouteDecision = {
      intent: "code",
      requiredTools: [],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "full",
      confidence: 0.8,
    };

    const result = filter.filterTools(allTools, decision);

    expect(result.filtered).toEqual(allTools);
  });

  it("filters files based on requiredFiles", () => {
    const filter = new ContextFilter();
    const allFiles = [
      "AGENTS.md",
      "src/index.ts",
      "docs/README.md",
      "package.json",
    ];
    const decision: RouteDecision = {
      intent: "file_ops",
      requiredTools: [],
      requiredFiles: ["AGENTS.md#section-3", "src/index.ts"],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.95,
    };

    const result = filter.filterFiles(allFiles, decision);

    expect(result.filtered).toContain("AGENTS.md");
    expect(result.filtered).toContain("src/index.ts");
    expect(result.filtered).not.toContain("docs/README.md");
  });

  it("calculates token savings", () => {
    const filter = new ContextFilter();
    const allTools = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const decision: RouteDecision = {
      intent: "file_ops",
      requiredTools: ["a", "b"],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.9,
    };

    const result = filter.filterTools(allTools, decision);

    // 2 out of 8 tools kept = 75% savings
    expect(result.savingsPercent).toBe(75);
  });

  it("handles empty required lists", () => {
    const filter = new ContextFilter();
    const allTools = ["fs_read", "shell_exec"];
    const decision: RouteDecision = {
      intent: "chat",
      requiredTools: [],
      requiredFiles: [],
      requiredSkills: [],
      contextSizeHint: "minimal",
      confidence: 0.99,
    };

    const result = filter.filterTools(allTools, decision);

    expect(result.filtered).toEqual([]);
    expect(result.savingsPercent).toBe(100);
  });
});