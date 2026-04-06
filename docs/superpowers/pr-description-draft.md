# PR Description — Final Draft

> **For:** AlexanderToner/openclaw-nexus → openclaw/openclaw
> **Target:** `main` branch
> **Status:** Ready to submit

---

## feat(nexus): pluggable TaskGraph infrastructure with checkpoint/resume and SSRF guard

### TL;DR

Adds a pluggable TaskGraph execution layer with crash-resilient checkpointing, fault-isolated SubAgents, and an SSRF-safe HTTP guard. Zero breaking changes to existing APIs. All new code is gated behind `taskgraph.enabled: false` by default.

> 💡 **Reviewer Tip:** This PR is functionally non-breaking. All logic is gated behind `taskgraph.enabled: false`. If preferred, I can split this into a security-only PR first (SSRF guard + config schema).

---

## What Changed

#### New files (19)

| Area             | Files                                                                    | Purpose                                                                                         |
| ---------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Config           | `src/config/zod-schema.ts` (diff), `src/config/types.openclaw.ts` (diff) | `taskgraph` config section: checkpoints, limits, timeouts                                       |
| Config accessor  | `src/taskgraph/config.ts`, `src/taskgraph/config.test.ts`                | `getTaskGraphConfig()` typed accessor with schema defaults                                      |
| Checkpoint       | `src/taskgraph/checkpoint.ts` (diff)                                     | Wired to configurable `storageDir` via `expandHomePrefix`                                       |
| SSRF guard       | `src/taskgraph/ssrf-guard.ts`, `src/taskgraph/ssrf-guard.test.ts`        | Blocks 127/10/172/192/169.254 IPs + metadata endpoints; `allowInternal`/`allowMetadata` options |
| SSRF integration | `src/agents/pi-embedded-runner/taskgraph-executor.ts` (diff)             | Guard called before HTTP requests in `callPlanningModel`                                        |
| SSRF tests       | `src/infra/taskgraph-ssrf.test.ts`                                       | 30 tests covering all blocked/safe patterns                                                     |
| e2e tests        | `test/taskgraph/taskgraph-e2e.test.ts`                                   | 8 tests for checkpoint lifecycle (save/restore/list/delete/stats/auto)                          |
| SubAgent audit   | `src/subagents/sandbox-status.md`                                        | Documents current security model and known gaps                                                 |
| Docs             | `docs/assets/nexus-architecture.mmd`                                     | Mermaid architecture diagram                                                                    |
| Docs             | `docs/plugins/subagent-registry.md`                                      | SubAgent registration guide                                                                     |
| Docs             | `docs/plugins/checkpoint-api.md`                                         | CheckpointManager API reference                                                                 |
| ADRs             | `docs/adr/0001-*.md`, `0002-*.md`, `0003-*.md`                           | Checkpoint design, sandbox profile, OOPIF handling                                              |
| Docs             | `README.md` (diff)                                                       | Added "Why Nexus?" section                                                                      |
| Docs             | `CONTRIBUTING.md` (diff)                                                 | Added nexus contribution guide                                                                  |

#### Modified files (6)

- `src/config/zod-schema.ts` — added `TaskGraphSchema`
- `src/config/types.openclaw.ts` — added `TaskGraphSettings` type
- `src/config/types.agent-defaults.ts` — renamed `TaskGraphConfig` → `TaskGraphExecutorConfig` (name collision)
- `src/taskgraph/checkpoint.ts` — uses `getTaskGraphConfig().checkpoints.storageDir`
- `src/agents/pi-embedded-runner/taskgraph-executor.ts` — SSRF guard before HTTP
- `.env.example` — added `OPENCLAW_TASKGRAPH_*` env vars

---

## Security Impact

- **Defense-in-Depth (SSRF)** — Integrated `SSRFGuard` before any `TaskGraph` outbound HTTP calls. This proactively mitigates risks from model-generated URLs targeting internal infrastructure or cloud metadata services (e.g., IMDSv2).
- **Surface Area Management** — New code is logic-isolated. It does not augment the existing `shell` or `file` tool execution paths, ensuring zero regression to current security audits.
- **No new permissions** — all TaskGraph features are off by default (`taskgraph.enabled: false`)
- **No existing permissions changed**
- **No new network surface** — guard only adds a check before existing HTTP calls

---

## Backward Compatibility

- ✅ Fully backward compatible — `taskgraph` config section is optional; all new code gated behind `taskgraph.enabled`
- ✅ No changes to existing channel plugins, provider plugins, or tool surface
- ✅ Existing `exec-approvals.ts` and `exec-safe-bin-policy.ts` unchanged

---

## Known Gaps (pre-flight for maintainers)

**1. SubAgent security model is lighter than `exec-safe-bin-policy.ts`**
`ShellAgent` and `FileAgent` use `SecurityArbiterInterface` (static allowlist). They do not use `exec-approvals.ts` (runtime socket-based approval). This is documented in `src/subagents/sandbox-status.md` with recommendations for future enhancement. Not a regression — existing shell exec behavior is unchanged.

**2. Viking Router (`TaskGraphExecutorConfig`) is internal**
The Viking Router trigger config was renamed to `TaskGraphExecutorConfig` to avoid a name collision. It is not yet documented as a public API.

**3. `intervalSteps` vs `autoCheckpointInterval`**
Checkpoint interval is time-based (`autoCheckpointInterval`, milliseconds) — not step-count-based. The `intervalSteps` field in the config schema exists for future use. Documented in ADR 0001.

---

## Test Plan

- [x] 30 SSRF guard tests (`src/infra/taskgraph-ssrf.test.ts`)
- [x] 8 TaskGraph e2e tests (`test/taskgraph/taskgraph-e2e.test.ts`)
- [x] 3 config integration tests (`src/taskgraph/config.test.ts`)
- [x] 13 CheckpointManager tests (`src/taskgraph/checkpoint.test.ts`)
- [x] `pnpm check` — lint, type-check, format (all pass)
- [x] Architecture boundary checks (`check-additional`) — pass
- [x] `git-secrets` scan — clean

---

## Why This Belongs in Core

TaskGraph with checkpoint/resume solves a real user pain: **long-running agent tasks cannot survive interruptions**. Every other approach (re-running the full task, manual state management) wastes API calls or requires operator intervention.

The existing agent system handles single-turn tasks well. Nexus extends that into multi-step, interruptible, recoverable execution — without touching the existing tool or channel surfaces.

---

## Related

- Architecture diagram: `docs/assets/nexus-architecture.mmd`
- ADR index: `docs/adr/README.md`
- SubAgent Registry guide: `docs/plugins/subagent-registry.md`
- Checkpoint API reference: `docs/plugins/checkpoint-api.md`
- Sandbox audit: `src/subagents/sandbox-status.md`
