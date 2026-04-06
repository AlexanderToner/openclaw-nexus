# OpenClaw Nexus — OSS Readiness Checklist

> For upstream proposal fork targeting `openclaw/openclaw`. Items tagged `[NEXUS]` are nexus-specific gaps; `[UPSTREAM]` items reuse existing upstream infrastructure.

**Owner:** Maintainer proposing nexus architecture
**Target:** Land nexus features as a PR/contribution to `openclaw/openclaw`
**Last updated:** 2026-04-06

---

## 1. Security & Privacy Audit

### 1.1 Sensitive Information Scanning

| #     | Item                                     | Status    | Action Needed                                                                                                                                                                                           |
| ----- | ---------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.1 | **Secrets baseline review** `[UPSTREAM]` | ✅ Exists | Verify `.secrets.baseline` covers nexus-specific paths (`src/infra/taskgraph/`, `src/infra/checkpoint/`, `src/agents/`). Run `detect-secrets scan --baseline .secrets.baseline` and audit new findings. |
| 1.1.2 | **Git history audit** `[NEXUS]`          | ⚠️ Review | Check if nexus-specific commits contain test API keys, session cookies, or internal hostnames. Use `git log -p` or `git-secrets --scan-history` on affected paths.                                      |
| 1.1.3 | **Test fixtures cleanup** `[NEXUS]`      | ⚠️ Review | Audit `test-fixtures/` and `test/` for any hardcoded tokens, real device IDs, or internal paths that wouldn't exist in an external developer's environment.                                             |
| 1.1.4 | **Env var exclusion list** `[UPSTREAM]`  | ✅ Exists | Confirm `.env.example` covers all nexus-specific env vars (e.g., `OPENCLAW_TASKGRAPH_*`, `OPENCLAW_CHECKPOINT_*`). Add any new ones.                                                                    |
| 1.1.5 | **Logs & debug output** `[NEXUS]`        | ⚠️ Review | Search for `console.log`/`logger.debug` that might output credentials or internal paths. Focus on `src/infra/taskgraph/`, `src/infra/checkpoint/`, and agent spawn paths.                               |

### 1.2 Agent Permission Boundaries

| #     | Item                                      | Status    | Action Needed                                                                                                                                                                  |
| ----- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.2.1 | **ShellAgent sandbox config** `[NEXUS]`   | 🔴 Gap    | Document the default sandbox profile for `ShellAgent`. Define: allowed commands allowlist, CPU/memory limits, network egress restrictions, and how operators can override.     |
| 1.2.2 | **FileAgent path restrictions** `[NEXUS]` | 🔴 Gap    | Define workspace boundary defaults (e.g., `$HOME` scope). Document how to configure `allowedPaths` / `deniedPaths` per agent session.                                          |
| 1.2.3 | **Subagent isolation model** `[NEXUS]`    | ⚠️ Review | Clarify fault isolation boundaries: if `BrowserAgent` or `FileAgent` crashes, does it kill the parent `TaskGraph`? Document recovery behavior.                                 |
| 1.2.4 | **Allowlist mechanism docs** `[NEXUS]`    | ⚠️ Review | Reviewed. Sandboxes are documented as a known gap in `src/subagents/sandbox-status.md`. See `SECURITY.md` for current state.                                                   |
| 1.2.5 | **PlaywrightAdapter sandbox** `[NEXUS]`   | ⚠️ Review | The nested OOPIF handling — confirm it runs in an isolated browser context. Document whether Playwright runs in `--no-sandbox` mode or with proper sandbox flags per platform. |

### 1.3 SSRF Protection

| #     | Item                                     | Status    | Action Needed                                                                                                                                                                                             |
| ----- | ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.3.1 | **TaskGraph HTTP hook** `[NEXUS]`        | ✅ Exists | TaskGraph HTTP hook implemented with SSRF protection: DNS rebinding protection, `Host:` header validation, IP range blocklist (private ranges: `10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`). |
| 1.3.2 | **Fetch allowlist for agents** `[NEXUS]` | ⚠️ Review | Check if agents can make arbitrary outbound HTTP calls. If so, document the allowlist mechanism (or lack thereof).                                                                                        |
| 1.3.3 | **SSRF test coverage** `[NEXUS]`         | ✅ Exists | SSRF test coverage added covering local IP access, `http://169.254.169.254/` (cloud metadata), and DNS rebinding scenarios.                                                                               |

> **Pro Tip (Security):** The most overlooked gap is **test fixtures with real credentials**. Teams often clean `.env` but forget `test-fixtures/`, `__fixtures__/`, or inline test data. Audit every test file that instantiates a client/SDK — if it has a fake key, confirm it looks fake (`sk-test-...`, `test-`, `example.com`). Real keys in tests end up in PR diffs and get rotated, causing CI failures post-merge.

---

## 2. Engineering Standards

### 2.1 Environment Consistency

| #     | Item                                  | Status    | Action Needed                                                                                                                                           |
| ----- | ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1.1 | **Dockerfile readiness** `[UPSTREAM]` | ✅ Exists | Verify `Dockerfile` includes nexus-specific dependencies: Playwright browsers (`playwright install`), Node 22+ for TaskGraph execution.                 |
| 2.1.2 | **Setup script** `[NEXUS]`            | ⚠️ Review | `docker-setup.sh` and `setup-podman.sh` exist. Verify they handle nexus-specific init (e.g., TaskGraph checkpoint directory, Playwright browser cache). |
| 2.1.3 | **Dev environment doc** `[NEXUS]`     | ⚠️ Review | Add a `docs/development/nexus-dev-setup.md` covering: `pnpm install`, Playwright browsers, Node version requirement, and any nexus-specific env vars.   |
| 2.1.4 | **Cross-platform deps** `[NEXUS]`     | ⚠️ Review | Playwright browser binaries are platform-specific. Confirm `package.json` has correct `playwright` optional deps for macOS (arm64/x64), Linux, Windows. |

### 2.2 Configuration Decoupling

| #     | Item                                      | Status    | Action Needed                                                                                                                                                         |
| ----- | ----------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.2.1 | **TaskGraph config surface** `[NEXUS]`    | ✅ Exists | TaskGraph config surface extracted to config schema. All hardcoded values (timeout, retry limits, max parallel steps, checkpoint frequency) are configurable.         |
| 2.2.2 | **Model parameter config** `[UPSTREAM]`   | ✅ Exists | Upstream config handles model params. Verify nexus TaskGraph uses the existing config system rather than hardcoding model choice or temperature.                      |
| 2.2.3 | **Checkpoint persistence path** `[NEXUS]` | ✅ Exists | Checkpoint persistence path is configurable via `OPENCLAW_STATE_DIR` or equivalent. Confirmed not hardcoded to `~/.openclaw/checkpoints`.                             |
| 2.2.4 | **Subagent registry config** `[NEXUS]`    | 🔴 Gap    | Define how new agents register into the `SubAgent Registry`. Is it code-based (auto-discover), config-based (yaml/json), or manifest-based? Document and standardize. |

### 2.3 CI/CD Integration

| #     | Item                                          | Status    | Action Needed                                                                                                                                                                  |
| ----- | --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.3.1 | **Lint workflow** `[UPSTREAM]`                | ✅ Exists | `ci.yml` covers linting. Add nexus-specific paths (`src/infra/taskgraph/`, `src/agents/`) to lint paths if not already included.                                               |
| 2.3.2 | **Vitest coverage** `[UPSTREAM]`              | ✅ Exists | Vitest config exists. Ensure nexus test files follow `*.test.ts` naming and are picked up by the test glob patterns in `vitest.*.config.ts`.                                   |
| 2.3.3 | **Type check gate** `[UPSTREAM]`              | ✅ Exists | `pnpm tsgo` covers TypeScript. Verify nexus code passes strict mode (`strict: true` in tsconfig).                                                                              |
| 2.3.4 | **Architecture boundary checks** `[UPSTREAM]` | ✅ Exists | `check-additional` CI lane enforces architecture boundaries. If nexus introduces new boundary violations (e.g., `extensions/` reaching into `src/infra/`), fix before landing. |
| 2.3.5 | **e2e test coverage** `[NEXUS]`               | ✅ Exists | TaskGraph e2e test coverage implemented: task creation → checkpoint save → simulated crash → resume → completion flow tested.                                                  |

> **Pro Tip (Engineering):** The most skipped step is **external contributor onboarding testing**. Run through your CI/CD pipeline as if you were an external developer who just cloned the repo — no pre-configured CI secrets, no local dev tools installed. This catches missing `pnpm install` steps, missing Playwright browser installation, and missing Node version guards that upstream maintainers never notice because they already have everything set up.

---

## 3. Documentation Excellence

### 3.1 README Architecture

| #     | Item                                 | Status    | Action Needed                                                                                                                                                                          |
| ----- | ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1.1 | **Architecture diagram** `[NEXUS]`   | ✅ Exists | Architecture diagram created at `docs/assets/nexus-architecture.svg` showing: `TaskGraph → Checkpoint → Subagents (Browser/File/Shell) → PlaywrightAdapter` with trust boundary lines. |
| 3.1.2 | **Technical moat section** `[NEXUS]` | ✅ Exists | "Why Nexus?" section added to `README.md` highlighting: (1) TaskGraph with checkpoint/resume, (2) Fault-isolated subagents, (3) PlaywrightAdapter OOPIF solution.                      |
| 3.1.3 | **Quick start for nexus** `[NEXUS]`  | ⚠️ Review | Existing `README.md` quick start is general. Add a 3-step "Hello TaskGraph" example demonstrating checkpoint/resume: create task, interrupt, resume.                                   |
| 3.1.4 | **Feature parity table** `[NEXUS]`   | ⚠️ Review | Add a table comparing nexus features vs. upstream baseline — shows reviewers what nexus adds without requiring them to dig through code.                                               |

### 3.2 Developer Guide (CONTRIBUTING.md)

| #     | Item                                            | Status    | Action Needed                                                                                                                                                                     |
| ----- | ----------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2.1 | **SubAgent Registry guide** `[NEXUS]`           | ✅ Exists | SubAgent Registry guide added at `docs/plugins/subagent-registry.md` explaining manifest format, interface contract (`AgentPlugin`), sandbox requirements, and test expectations. |
| 3.2.2 | **Checkpoint API docs** `[NEXUS]`               | ✅ Exists | Checkpoint API docs completed: state saved, serialization format, rollback semantics, and how to add a new checkpointable component.                                              |
| 3.2.3 | **PlaywrightAdapter extension guide** `[NEXUS]` | ⚠️ Review | Document how PlaywrightAdapter handles nested OOPIFs. This is a technical differentiator — explain the problem and solution clearly for future contributors.                      |
| 3.2.4 | **CONTRIBUTING.md update** `[NEXUS]`            | ⚠️ Review | Add nexus-specific contribution guidelines to `CONTRIBUTING.md`: new agent checklist, checkpoint test requirements, sandbox policy.                                               |

### 3.3 API Contract Documentation

| #     | Item                                     | Status    | Action Needed                                                                                                                                                                 |
| ----- | ---------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.3.1 | **Plugin SDK nexus additions** `[NEXUS]` | ✅ Exists | Plugin SDK nexus additions documented in `docs/plugins/sdk-entrypoints.md`.                                                                                                   |
| 3.3.2 | **Agent manifest schema** `[NEXUS]`      | ✅ Exists | Agent manifest schema defined and documented: required fields (`id`, `name`, `capabilities`), optional fields (`sandbox`, `timeout`, `checkpointable`), and validation rules. |
| 3.3.3 | **ADR documentation** `[NEXUS]`          | ✅ Exists | Architecture decision records (ADRs) created in `docs/adr/` covering key design decisions.                                                                                    |

> **Pro Tip (Documentation):** Engineers write docs **once at launch** and never update them. The most valuable documentation investment is a **living architecture decision record (ADR)** — a short `docs/adr/` directory with numbered files (`0001-taskgraph-checkpoint-design.md`, `0002-subagent-sandbox-profile.md`) explaining _why_ decisions were made. Future contributors (and reviewers) will thank you. ADRs also serve as the "design intent" section of PR descriptions automatically.

---

## 4. Community & Legal

### 4.1 Open Source License

| #     | Item                                                 | Status    | Action Needed                                                                                                                                                                                       |
| ----- | ---------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1.1 | **License compatibility** `[UPSTREAM]`               | ✅ MIT    | Upstream uses MIT. Nexus contributions to `openclaw/openclaw` are automatically MIT-licensed under the existing framework. Confirm no nexus-specific dependencies introduce AGPL/GPL contamination. |
| 4.1.2 | **License file** `[UPSTREAM]`                        | ✅ Exists | `LICENSE` (MIT) is present. No changes needed.                                                                                                                                                      |
| 4.1.3 | **Contributor License Agreement (CLA)** `[UPSTREAM]` | ⚠️ Review | Check if `openclaw/openclaw` requires a CLA. If not, MIT is sufficient. If yes, link to the DCO/CLA process in `CONTRIBUTING.md`.                                                                   |

### 4.2 Issue & PR Templates

| #     | Item                                      | Status    | Action Needed                                                                                                                                                  |
| ----- | ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.2.1 | **Bug report template** `[UPSTREAM]`      | ✅ Exists | `.github/ISSUE_TEMPLATE/bug_report.yml` is comprehensive. Add a `nexus-component` dropdown option if the bug is nexus-specific.                                |
| 4.2.2 | **Feature request template** `[UPSTREAM]` | ✅ Exists | `.github/ISSUE_TEMPLATE/feature_request.yml` exists. Add nexus category if needed.                                                                             |
| 4.2.3 | **PR template** `[UPSTREAM]`              | ✅ Exists | `.github/pull_request_template.md` is detailed. Add a "Nexus Changes" section to the checklist if nexus touches TaskGraph, Checkpoint, or Subagent boundaries. |
| 4.2.4 | **Nexus-specific issue label** `[NEXUS]`  | ⚠️ Review | Coordinate with upstream maintainers to add `nexus` label to the repo before/after landing.                                                                    |

### 4.3 Roadmap Publication

| #     | Item                                         | Status    | Action Needed                                                                                                                                                                           |
| ----- | -------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.3.1 | **Nexus roadmap alignment** `[NEXUS]`        | ⚠️ Review | Map nexus Phase 2b/2c/3 plans to the upstream `openclaw/openclaw` roadmap. Identify which nexus features need upstream buy-in before landing.                                           |
| 4.3.2 | **GitHub Projects integration** `[UPSTREAM]` | ✅ Exists | Upstream uses GitHub Projects. Add nexus items as a separate view or project if they won't immediately be merged.                                                                       |
| 4.3.3 | **Changelog strategy** `[UPSTREAM]`          | ✅ Exists | `CHANGELOG.md` format exists. Nexus additions should be added under a new version block with `### Changes` for new features, `### Improvements` for engineering work.                   |
| 4.3.4 | **Roadmap visibility** `[NEXUS]`             | ✅ Exists | Roadmap visibility addressed. Consider `docs/roadmap.md` or GitHub Milestones for nexus phases. "What's Next" section in README or separate roadmap doc helps contributor expectations. |

### 4.4 Community Infrastructure

| #     | Item                                      | Status    | Action Needed                                                                                                                                            |
| ----- | ----------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.4.1 | **Discord/Discussion forum** `[UPSTREAM]` | ✅ Exists | Upstream Discord (`discord.gg/clawd`) can host nexus discussions. No new infra needed.                                                                   |
| 4.4.2 | **CODEOWNERS review** `[NEXUS]`           | ⚠️ Review | If nexus introduces new code owners (e.g., new `src/infra/taskgraph/` directory), update `.github/CODEOWNERS` to route reviews appropriately.            |
| 4.4.3 | **Security disclosure path** `[UPSTREAM]` | ✅ Exists | `SECURITY.md` with `security@openclaw.ai` exists. Nexus-specific security questions route through the same path. Add a nexus-specific contact if needed. |

> **Pro Tip (Community):** The single most impactful community action before opening a large PR is **informal pre-alignment**. Before submitting the nexus PR, open a GitHub Discussion in `openclaw/openclaw` titled "RFC: Nexus Architecture — TaskGraph + Checkpoint + Subagents" with a 500-word summary, architecture diagram, and specific questions for maintainers. This surfaces objections _before_ you write code, not after. Open source maintainers are far more receptive to well-framed RFCs than to surprise PRs with 10,000 lines of changes.

---

## Summary Scorecard

| Section                  | ✅ Done | ⚠️ Review | 🔴 Gap | Total  |
| ------------------------ | ------- | --------- | ------ | ------ |
| 1. Security & Privacy    | 2       | 10        | 2      | 14     |
| 2. Engineering Standards | 9       | 2         | 0      | 11     |
| 3. Documentation         | 8       | 1         | 2      | 11     |
| 4. Community & Legal     | 10      | 4         | 0      | 14     |
| **Total**                | **29**  | **17**    | **4**  | **50** |

### Priority Order (recommended sequence)

1. **P0 — Security blockers** (items 1.1.x, 1.2.x, 1.3.x): Fix before any code review
2. **P1 — Engineering gaps** (items 2.2.x, 2.3.5): Required for CI to pass
3. **P2 — Documentation** (items 3.1.x, 3.2.x): Required for maintainer acceptance
4. **P3 — Community polish** (items 4.2.x, 4.3.x): Nice to have before RFC

---

## Appendix: Key Files Reference

| Area              | Relevant Files                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Security scanning | `.secrets.baseline`, `SECURITY.md`, `src/infra/exec-safety.ts`, `src/infra/exec-approvals.ts` |
| Agent sandbox     | `src/agents/`, `src/infra/exec-safe-bin-policy.ts`, `src/infra/host-env-security.ts`          |
| CI/CD             | `.github/workflows/ci.yml`, `vitest.config.ts`, `vitest.e2e.config.ts`                        |
| Config schema     | `src/config/`, `.env.example`, `docs/configuration.md`                                        |
| Plugin SDK        | `docs/plugins/sdk-*.md`, `src/plugin-sdk/`, `scripts/lib/plugin-sdk-entrypoints.json`         |
| Dockerfile        | `Dockerfile`, `Dockerfile.sandbox`, `Dockerfile.sandbox-browser`, `docker-setup.sh`           |
| Contributing      | `CONTRIBUTING.md`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/`              |
| License           | `LICENSE` (MIT)                                                                               |
