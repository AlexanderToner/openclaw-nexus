# ADR 0002: SubAgent Sandbox Profile

**Date:** 2026-04-06
**Status:** Accepted

## Context

Each SubAgent type has different risk profiles. We evaluated per-agent full isolation vs. shared policy.

## Decision

SubAgents use the `SecurityArbiterInterface` for access control. ShellAgent requires a security arbiter (throws if not provided). FileAgent optionally uses path boundary checks. BrowserAgent runs in Playwright's built-in sandbox.

Key insight: ShellAgent and FileAgent use a **static policy model** (allowlist-based), while OpenClaw's `exec-approvals.ts` provides a **runtime approval model** (socket-based, operator-interactive). SubAgents currently use the static policy only — runtime approval is a potential future enhancement.

## Consequences

**Pros:**

- Deterministic behavior without operator interaction
- Clear security boundaries per agent type
- Aligns with existing SecurityArbiter patterns

**Cons:**

- Commands outside the allowlist require pre-approval configuration
- No runtime per-command approval for SubAgents (unlike shell exec)
