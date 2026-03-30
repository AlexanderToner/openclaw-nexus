// src/viking/context-filter.ts
/**
 * Context Filter
 *
 * Filters tools, files, and skills based on RouteDecision
 * to minimize token consumption by loading only what's needed.
 */

import type { RouteDecision, ContextFilterResult } from "./types.js";

export interface FilterResult {
  /** Items that passed the filter */
  filtered: string[];

  /** Items that were filtered out */
  filteredOut: string[];

  /** Percentage of items filtered out */
  savingsPercent: number;
}

/**
 * ContextFilter reduces context size by filtering out unnecessary
 * tools, files, and skills based on the routing decision.
 *
 * Token savings come from:
 * 1. Loading only required tool definitions instead of all tools
 * 2. Loading only relevant files/sections instead of full context
 * 3. Activating only needed skills instead of all skills
 */
export class ContextFilter {
  /**
   * Filter tools based on RouteDecision.
   *
   * @param allTools - All available tool names
   * @param decision - The routing decision
   * @returns FilterResult with filtered tools and savings
   */
  filterTools(allTools: string[], decision: RouteDecision): FilterResult {
    // When contextSizeHint is "full", include everything
    if (decision.contextSizeHint === "full") {
      return {
        filtered: allTools,
        filteredOut: [],
        savingsPercent: 0,
      };
    }

    // Filter to only required tools
    const requiredSet = new Set(decision.requiredTools);
    const filtered: string[] = [];
    const filteredOut: string[] = [];

    for (const tool of allTools) {
      if (requiredSet.has(tool)) {
        filtered.push(tool);
      } else {
        filteredOut.push(tool);
      }
    }

    const savingsPercent =
      allTools.length > 0 ? Math.round((filteredOut.length / allTools.length) * 100) : 0;

    return { filtered, filteredOut, savingsPercent };
  }

  /**
   * Filter files based on RouteDecision.
   *
   * @param allFiles - All available file paths
   * @param decision - The routing decision
   * @returns FilterResult with filtered files and savings
   */
  filterFiles(allFiles: string[], decision: RouteDecision): FilterResult {
    // When contextSizeHint is "full", include everything
    if (decision.contextSizeHint === "full") {
      return {
        filtered: allFiles,
        filteredOut: [],
        savingsPercent: 0,
      };
    }

    // Extract base file names from requiredFiles (may include #section suffixes)
    const requiredBaseNames = new Set(decision.requiredFiles.map((f) => f.split("#")[0]));

    const filtered: string[] = [];
    const filteredOut: string[] = [];

    for (const file of allFiles) {
      if (requiredBaseNames.has(file)) {
        filtered.push(file);
      } else {
        filteredOut.push(file);
      }
    }

    const savingsPercent =
      allFiles.length > 0 ? Math.round((filteredOut.length / allFiles.length) * 100) : 0;

    return { filtered, filteredOut, savingsPercent };
  }

  /**
   * Filter skills based on RouteDecision.
   *
   * @param allSkills - All available skill names
   * @param decision - The routing decision
   * @returns FilterResult with filtered skills and savings
   */
  filterSkills(allSkills: string[], decision: RouteDecision): FilterResult {
    // When contextSizeHint is "full", include everything
    if (decision.contextSizeHint === "full") {
      return {
        filtered: allSkills,
        filteredOut: [],
        savingsPercent: 0,
      };
    }

    const requiredSet = new Set(decision.requiredSkills);
    const filtered: string[] = [];
    const filteredOut: string[] = [];

    for (const skill of allSkills) {
      if (requiredSet.has(skill)) {
        filtered.push(skill);
      } else {
        filteredOut.push(skill);
      }
    }

    const savingsPercent =
      allSkills.length > 0 ? Math.round((filteredOut.length / allSkills.length) * 100) : 0;

    return { filtered, filteredOut, savingsPercent };
  }

  /**
   * Apply all filters and return combined result.
   *
   * @param context - Available context items
   * @param decision - The routing decision
   * @returns Combined ContextFilterResult
   */
  applyFilters(
    context: {
      tools: string[];
      files: string[];
      skills: string[];
    },
    decision: RouteDecision,
  ): ContextFilterResult {
    const toolsResult = this.filterTools(context.tools, decision);
    const filesResult = this.filterFiles(context.files, decision);
    const skillsResult = this.filterSkills(context.skills, decision);

    // Calculate overall savings
    const totalItems = context.tools.length + context.files.length + context.skills.length;
    const savedItems =
      toolsResult.filteredOut.length +
      filesResult.filteredOut.length +
      skillsResult.filteredOut.length;

    const tokenSavingsPercent = totalItems > 0 ? Math.round((savedItems / totalItems) * 100) : 0;

    return {
      tools: toolsResult.filtered,
      files: filesResult.filtered,
      skills: skillsResult.filtered,
      tokenSavingsPercent,
    };
  }
}
