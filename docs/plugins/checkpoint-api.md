# TaskGraph Checkpoint API

The CheckpointManager persists TaskGraph execution state for resumable tasks.

## Overview

Checkpoints enable TaskGraph to recover from interruptions by saving the current execution state, including the step index, completed steps, and metadata. When a task is re-run with an existing checkpoint, execution resumes from the saved state.

## State Serialization

On each checkpoint, the following is saved:

- Current step index
- Number of completed steps
- TaskGraph state (via TaskGraphStore)
- Timestamp and metadata

Checkpoint metadata files are stored at `~/.openclaw/taskgraphs/checkpoints/{taskId}/{checkpointName}.meta.json`.

## Configuration

```json
{
  "taskgraph": {
    "checkpoints": {
      "enabled": true,
      "intervalSteps": 5,
      "storageDir": "~/.openclaw/taskgraphs/checkpoints"
    }
  }
}
```

## API Reference

### CheckpointManager

```typescript
import { CheckpointManager } from "openclaw/plugin-sdk";
import { TaskGraphStore } from "openclaw/plugin-sdk";

const manager = new CheckpointManager(store, autoCheckpointInterval);
```

#### createCheckpoint(graph, name, reason, description?)

Creates a checkpoint for the given TaskGraph.

**Parameters:**

- `graph: TaskGraph` - The TaskGraph to checkpoint
- `name: string` - Checkpoint name
- `reason: CheckpointReason` - Reason for checkpoint
- `description?: string` - Optional description

**Returns:** `Promise<CheckpointMeta>`

**Checkpoint Reasons:**

- `before_critical_step` - Before executing a critical step
- `after_phase_complete` - After completing a phase
- `user_requested` - Manually requested by user
- `auto_scheduled` - Automatically scheduled
- `before_retry` - Before retrying after failure

#### restoreCheckpoint(taskId, name)

Restores a TaskGraph from a checkpoint.

**Parameters:**

- `taskId: string` - Task ID
- `name: string` - Checkpoint name

**Returns:** `Promise<TaskGraph | null>` - Restored TaskGraph or null if not found

#### listCheckpoints(taskId)

Lists all checkpoints for a task.

**Parameters:**

- `taskId: string` - Task ID

**Returns:** `Promise<CheckpointMeta[]>` - Array of checkpoints sorted by creation time (newest first)

#### deleteCheckpoint(taskId, name)

Deletes a checkpoint.

**Parameters:**

- `taskId: string` - Task ID
- `name: string` - Checkpoint name

**Returns:** `Promise<boolean>` - true if deleted

#### findLatestCheckpoint(taskId)

Returns the most recent checkpoint for a task.

**Parameters:**

- `taskId: string` - Task ID

**Returns:** `Promise<CheckpointMeta | null>` - Most recent checkpoint or null

#### getCheckpointStats(taskId)

Returns checkpoint statistics for a task.

**Parameters:**

- `taskId: string` - Task ID

**Returns:** `Promise<{ count: number; oldestCheckpoint?: CheckpointMeta; newestCheckpoint?: CheckpointMeta }>`

#### maybeAutoCheckpoint(graph)

Creates an automatic checkpoint if the interval has elapsed.

**Parameters:**

- `graph: TaskGraph` - Current TaskGraph

**Returns:** `Promise<CheckpointMeta | null>` - Checkpoint metadata or null

#### checkpointBeforeStep(graph, step)

Creates a checkpoint before a critical step.

**Parameters:**

- `graph: TaskGraph` - TaskGraph
- `step: Step` - The critical step

**Returns:** `Promise<CheckpointMeta>`

## CheckpointMeta

```typescript
interface CheckpointMeta {
  name: string;
  taskId: string;
  createdAt: number;
  stepIndex: number;
  completedSteps: number;
  reason: CheckpointReason;
  description?: string;
}
```

## Lifecycle

1. **Created**: Before critical steps, after phase completion, via user request, or automatically on interval
2. **Restored**: When a task with an active checkpoint is re-run
3. **Deleted**: When a task completes successfully, or manually via `deleteCheckpoint()`

## Usage Example

```typescript
import { CheckpointManager } from "openclaw/plugin-sdk";

// Create a checkpoint manager
const manager = new CheckpointManager(store, 60000); // 60s auto interval

// Create a checkpoint before a critical operation
const meta = await manager.createCheckpoint(
  graph,
  "before-deploy",
  "before_critical_step",
  "Checkpoint before deployment step",
);

// List available checkpoints
const checkpoints = await manager.listCheckpoints(taskId);

// Restore from checkpoint
const restored = await manager.restoreCheckpoint(taskId, "before-deploy");

// Clean up checkpoint when done
await manager.deleteCheckpoint(taskId, "before-deploy");
```
