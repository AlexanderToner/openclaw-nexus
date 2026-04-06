# ADR 0001: TaskGraph Checkpoint Design

**Date:** 2026-04-06
**Status:** Accepted

## Context

Long-running TaskGraph tasks need to survive interruptions (operator stop, crash, restart) without losing progress. We evaluated three approaches:

1. **No checkpointing** — simple but loses all progress on interrupt
2. **Eager checkpointing** — checkpoint after every step, high storage overhead
3. **Interval checkpointing** — checkpoint every N steps (configurable)

## Decision

Use **interval checkpointing** with a time-based configurable interval (`autoCheckpointInterval`, milliseconds). Checkpoints can also be created manually via `createCheckpoint`. Checkpoints are stored as JSON files under `~/.openclaw/taskgraphs/checkpoints/{taskId}/`.

The CheckpointManager provides `createCheckpoint`, `restoreCheckpoint`, `listCheckpoints`, `deleteCheckpoint`, `findLatestCheckpoint`, and `maybeAutoCheckpoint` methods.

## Consequences

**Pros:**

- Configurable overhead (interval adjustable)
- Crash recovery without API call waste
- Supports parallel task graphs (each stored separately)
- Time-based auto-checkpointing as an alternative

**Cons:**

- State must be serializable (Planner state must support serialization)
- Checkpoint on non-idempotent steps requires careful ordering
