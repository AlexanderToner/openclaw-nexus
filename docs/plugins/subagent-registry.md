---
title: "SubAgent Registry"
summary: "Register and extend SubAgents for TaskGraph step execution"
---

# SubAgent Registry

SubAgents are sandboxed execution units that handle specific step types in a TaskGraph. Each SubAgent is responsible for a particular domain of operations, such as shell commands, file system access, or browser automation.

## Available Agents

| Agent          | Step Type | Security Model                        | Description                                                           |
| -------------- | --------- | ------------------------------------- | --------------------------------------------------------------------- |
| `ShellAgent`   | `shell`   | Security arbiter command whitelist    | Execute shell commands with policy enforcement                        |
| `FileAgent`    | `file`    | Optional security arbiter path checks | File system operations (read, write, list, move, copy, delete, mkdir) |
| `BrowserAgent` | `browser` | Security arbiter domain checks        | Browser automation (navigate, click, type, extract, screenshot, wait) |
| `GUIAgent`     | `gui`     | Platform-specific sandboxing          | Desktop GUI automation (placeholder)                                  |

## Core Interfaces

### SubAgent

```typescript
import type { SubAgent, SubAgentContext, SubAgentResult } from "openclaw/plugin-sdk/subagent-types";

interface SubAgent {
  readonly type: SubAgentType;
  readonly name: string;
  readonly description: string;

  canHandle(step: Step): boolean;
  execute(step: Step, context: SubAgentContext): Promise<SubAgentResult>;
  validate?(step: Step): ValidationResult;
}
```

### SubAgentContext

```typescript
interface SubAgentContext {
  taskId: string;
  workingDir: string;
  timeoutMs: number;
  state: Map<string, unknown>;
  securityArbiter?: SecurityArbiterInterface;
  env?: Record<string, string>;
  logger?: LoggerInterface;
}
```

### SubAgentResult

```typescript
interface SubAgentResult {
  stepId: string;
  status: "success" | "failed" | "skipped" | "timeout" | "cancelled";
  output?: unknown;
  error?: SubAgentError;
  stateUpdates?: Record<string, unknown>;
  metadata?: {
    durationMs: number;
    tokensUsed?: number;
    retries?: number;
  };
}
```

### SecurityArbiterInterface

```typescript
interface SecurityArbiterInterface {
  checkPath(path: string): SecurityCheckResult;
  checkCommand(command: string): SecurityCheckResult;
  checkDomain(domain: string): SecurityCheckResult;
  checkPort(port: number): SecurityCheckResult;
}

interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  rule?: string;
}
```

## Registering a New Agent

### 1. Define your agent

```typescript
import type { Step } from "../taskgraph/types.js";
import type { SubAgent, SubAgentContext, SubAgentResult } from "./types.js";

export class YourAgent implements SubAgent {
  type = "your-type" as const;
  name = "your-agent";
  description = "Handles your custom operations";

  canHandle(step: Step): boolean {
    return step.type === "your-type";
  }

  async execute(step: Step, context: SubAgentContext): Promise<SubAgentResult> {
    const startTime = Date.now();

    try {
      // Your implementation here
      const output = await this.performAction(step);

      return {
        stepId: step.id,
        status: "success",
        output,
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        stepId: step.id,
        status: "failed",
        error: {
          type: this.classifyError(error),
          message: error instanceof Error ? error.message : String(error),
          retryable: this.isRetryable(error),
          cause: error,
        },
        metadata: {
          durationMs: Date.now() - startTime,
        },
      };
    }
  }
}
```

### 2. Register it

```typescript
import { globalRegistry } from "openclaw/subagents/registry.js";

globalRegistry.register(new YourAgent(), {
  priority: 100,
  capabilities: {
    operations: ["custom-action"],
    requiredPermissions: ["network"],
  },
});
```

### 3. Using the registry

```typescript
import { globalRegistry } from "openclaw/subagents/registry.js";

// Find the best agent for a step
const agent = globalRegistry.getAgent(step);

// Check if a type has registered agents
if (globalRegistry.hasType("shell")) {
  // ...
}

// Get all agents of a type
const shellAgents = globalRegistry.getAgentsByType("shell");

// Validate a step before execution
const validation = globalRegistry.validateStep(step);
if (!validation.valid) {
  console.error("Validation errors:", validation.errors);
}

// Get registry statistics
const stats = globalRegistry.getStats();
console.log(`Total agents: ${stats.totalAgents}`);
```

## Security Model

SubAgents use the `SecurityArbiterInterface` for access control:

| Agent          | Required | Checks                               |
| -------------- | -------- | ------------------------------------ |
| `ShellAgent`   | Yes      | `checkCommand()` - command whitelist |
| `FileAgent`    | Optional | `checkPath()` - path boundaries      |
| `BrowserAgent` | Optional | `checkDomain()` - URL whitelist      |
| `GUIAgent`     | N/A      | Platform-specific sandboxing         |

**ShellAgent** throws if no security arbiter is configured:

```typescript
if (!context.securityArbiter) {
  throw new Error("No security arbiter configured for shell execution");
}
```

**FileAgent** and **BrowserAgent** allow operations without a security arbiter but enforce restrictions when one is provided.

## Testing

Unit test your agent with mocked context:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ShellAgent } from "../shell-agent.js";

describe("ShellAgent", () => {
  it("executes allowed commands", async () => {
    const securityArbiter = {
      checkCommand: vi.fn().mockReturnValue({ allowed: true }),
    };

    const context = {
      taskId: "test-task",
      workingDir: "/tmp",
      timeoutMs: 5000,
      state: new Map(),
      securityArbiter,
      env: {},
    };

    const step = {
      id: "step-1",
      type: "shell" as const,
      action: { command: "echo hello" },
    };

    const result = await new ShellAgent().execute(step, context);

    expect(result.status).toBe("success");
    expect(securityArbiter.checkCommand).toHaveBeenCalledWith("echo hello");
  });

  it("blocks disallowed commands", async () => {
    const securityArbiter = {
      checkCommand: vi.fn().mockReturnValue({
        allowed: false,
        reason: "Command not in whitelist",
      }),
    };

    const context = {
      taskId: "test-task",
      workingDir: "/tmp",
      timeoutMs: 5000,
      state: new Map(),
      securityArbiter,
    };

    const step = {
      id: "step-1",
      type: "shell" as const,
      action: { command: "rm -rf /" },
    };

    const result = await new ShellAgent().execute(step, context);

    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("security_blocked");
  });
});
```

Run: `pnpm test -- src/subagents/your-agent.test.ts`

## Error Types

SubAgents classify errors using `SubAgentErrorType`:

| Type                 | Description                       |
| -------------------- | --------------------------------- |
| `resource_not_found` | Requested resource does not exist |
| `permission_denied`  | Operation not permitted           |
| `timeout`            | Operation exceeded time limit     |
| `security_blocked`   | Blocked by security policy        |
| `dependency_failed`  | Required dependency unavailable   |
| `invalid_input`      | Step parameters are invalid       |
| `execution_error`    | General execution failure         |
| `network_error`      | Network connectivity issue        |
| `rate_limited`       | Rate limit exceeded               |
| `unknown`            | Unclassified error                |

## Related

- [Plugin SDK Overview](/plugins/sdk-overview) - SDK import conventions
- [Plugin Architecture](/plugins/architecture) - Plugin system internals
