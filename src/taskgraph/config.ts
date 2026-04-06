/**
 * TaskGraph Configuration Accessor
 *
 * Provides typed access to TaskGraph configuration from the global config.
 */

import { loadConfig } from "../config/config.js";
import type { TaskGraphSettings } from "../config/types.openclaw.js";

// Re-export the type for consumers
export type { TaskGraphSettings } from "../config/types.openclaw.js";

/**
 * Resolved TaskGraph configuration with all values populated.
 * Used as the return type for getTaskGraphConfig().
 */
export interface TaskGraphConfig {
  enabled: boolean;
  checkpoints: {
    enabled: boolean;
    intervalSteps: number;
    storageDir: string;
  };
  limits: {
    maxSteps: number;
    maxRetries: number;
    maxReplans: number;
    stepTimeoutMs: number;
  };
}

const DEFAULT_TASKGRAPH_CONFIG: TaskGraphConfig = {
  enabled: true,
  checkpoints: {
    enabled: true,
    intervalSteps: 5,
    storageDir: "~/.openclaw/taskgraphs/checkpoints",
  },
  limits: {
    maxSteps: 50,
    maxRetries: 3,
    maxReplans: 2,
    stepTimeoutMs: 120_000,
  },
};

/**
 * Get the TaskGraph configuration from the global config.
 * Returns default values if taskgraph config is not set.
 */
export function getTaskGraphConfig(): TaskGraphConfig {
  const cfg = loadConfig();
  const taskgraph = cfg.taskgraph;

  if (!taskgraph) {
    return DEFAULT_TASKGRAPH_CONFIG;
  }

  return {
    enabled: taskgraph.enabled ?? DEFAULT_TASKGRAPH_CONFIG.enabled,
    checkpoints: {
      enabled: taskgraph.checkpoints?.enabled ?? DEFAULT_TASKGRAPH_CONFIG.checkpoints.enabled,
      intervalSteps:
        taskgraph.checkpoints?.intervalSteps ?? DEFAULT_TASKGRAPH_CONFIG.checkpoints.intervalSteps,
      storageDir:
        taskgraph.checkpoints?.storageDir ?? DEFAULT_TASKGRAPH_CONFIG.checkpoints.storageDir,
    },
    limits: {
      maxSteps: taskgraph.limits?.maxSteps ?? DEFAULT_TASKGRAPH_CONFIG.limits.maxSteps,
      maxRetries: taskgraph.limits?.maxRetries ?? DEFAULT_TASKGRAPH_CONFIG.limits.maxRetries,
      maxReplans: taskgraph.limits?.maxReplans ?? DEFAULT_TASKGRAPH_CONFIG.limits.maxReplans,
      stepTimeoutMs:
        taskgraph.limits?.stepTimeoutMs ?? DEFAULT_TASKGRAPH_CONFIG.limits.stepTimeoutMs,
    },
  };
}
