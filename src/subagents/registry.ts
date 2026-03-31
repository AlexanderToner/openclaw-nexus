// src/subagents/registry.ts
/**
 * SubAgent Registry
 *
 * Manages registration and lookup of SubAgents.
 * Provides a central point for discovering available agents.
 */

import type { Step } from "../taskgraph/types.js";
import type { SubAgent, SubAgentType, SubAgentCapability, ValidationResult } from "./types.js";

/**
 * Registry entry for a registered SubAgent.
 */
interface RegistryEntry {
  agent: SubAgent;
  capabilities: SubAgentCapability;
  priority: number;
}

/**
 * SubAgentRegistry manages the collection of available SubAgents.
 */
export class SubAgentRegistry {
  private agents: Map<SubAgentType, RegistryEntry[]> = new Map();
  private defaultPriorities: Map<SubAgentType, number> = new Map();

  /**
   * Register a SubAgent.
   *
   * @param agent - The agent to register
   * @param options - Registration options
   */
  register(
    agent: SubAgent,
    options?: {
      priority?: number;
      capabilities?: SubAgentCapability;
    },
  ): void {
    const priority = options?.priority ?? this.getDefaultPriority(agent.type);
    const capabilities = options?.capabilities ?? this.inferCapabilities(agent);

    const entry: RegistryEntry = {
      agent,
      capabilities,
      priority,
    };

    const entries = this.agents.get(agent.type) ?? [];
    entries.push(entry);

    // Sort by priority (higher first)
    entries.sort((a, b) => b.priority - a.priority);

    this.agents.set(agent.type, entries);
  }

  /**
   * Unregister a SubAgent.
   *
   * @param agent - The agent to unregister
   * @returns true if unregistered, false if not found
   */
  unregister(agent: SubAgent): boolean {
    const entries = this.agents.get(agent.type);
    if (!entries) {
      return false;
    }

    const index = entries.findIndex((e) => e.agent === agent);
    if (index === -1) {
      return false;
    }

    entries.splice(index, 1);
    return true;
  }

  /**
   * Get the best agent for a step.
   *
   * @param step - The step to find an agent for
   * @returns The best matching agent or null
   */
  getAgent(step: Step): SubAgent | null {
    const entries = this.agents.get(step.type);
    if (!entries || entries.length === 0) {
      return null;
    }

    // Find the first agent that can handle this step
    for (const entry of entries) {
      if (entry.agent.canHandle(step)) {
        return entry.agent;
      }
    }

    // Fall back to first registered agent
    return entries[0]?.agent ?? null;
  }

  /**
   * Get all agents of a specific type.
   *
   * @param type - The agent type
   * @returns Array of agents
   */
  getAgentsByType(type: SubAgentType): SubAgent[] {
    const entries = this.agents.get(type) ?? [];
    return entries.map((e) => e.agent);
  }

  /**
   * Get all registered agents.
   *
   * @returns Array of all agents
   */
  getAllAgents(): SubAgent[] {
    const allAgents: SubAgent[] = [];
    for (const entries of this.agents.values()) {
      allAgents.push(...entries.map((e) => e.agent));
    }
    return allAgents;
  }

  /**
   * Check if an agent type is registered.
   *
   * @param type - The agent type
   * @returns true if at least one agent is registered
   */
  hasType(type: SubAgentType): boolean {
    const entries = this.agents.get(type);
    return entries !== undefined && entries.length > 0;
  }

  /**
   * Get capabilities for an agent.
   *
   * @param agent - The agent
   * @returns Capabilities or undefined
   */
  getCapabilities(agent: SubAgent): SubAgentCapability | undefined {
    const entries = this.agents.get(agent.type);
    if (!entries) {
      return undefined;
    }

    const entry = entries.find((e) => e.agent === agent);
    return entry?.capabilities;
  }

  /**
   * Validate a step using the appropriate agent.
   *
   * @param step - The step to validate
   * @returns Validation result
   */
  validateStep(step: Step): ValidationResult {
    const agent = this.getAgent(step);
    if (!agent) {
      return {
        valid: false,
        errors: [`No agent registered for step type: ${step.type}`],
      };
    }

    if (agent.validate) {
      return agent.validate(step);
    }

    // Default validation
    return { valid: true };
  }

  /**
   * Set default priority for an agent type.
   *
   * @param type - The agent type
   * @param priority - Default priority
   */
  setDefaultPriority(type: SubAgentType, priority: number): void {
    this.defaultPriorities.set(type, priority);
  }

  /**
   * Get default priority for an agent type.
   */
  private getDefaultPriority(type: SubAgentType): number {
    return this.defaultPriorities.get(type) ?? 100;
  }

  /**
   * Infer capabilities from an agent.
   */
  private inferCapabilities(_agent: SubAgent): SubAgentCapability {
    return {
      operations: [],
      limits: {
        maxTimeoutMs: 300000, // 5 minutes
      },
    };
  }

  /**
   * Clear all registered agents.
   */
  clear(): void {
    this.agents.clear();
  }

  /**
   * Get registry statistics.
   */
  getStats(): {
    totalAgents: number;
    byType: Record<SubAgentType, number>;
  } {
    const byType: Record<string, number> = {};

    for (const [type, entries] of this.agents) {
      byType[type] = entries.length;
    }

    const totalAgents = Array.from(this.agents.values()).reduce(
      (sum, entries) => sum + entries.length,
      0,
    );

    return { totalAgents, byType };
  }
}

/**
 * Global registry instance.
 */
export const globalRegistry = new SubAgentRegistry();
