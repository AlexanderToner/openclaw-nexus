# SubAgent Sandbox Status

This document tracks the security integration status of SubAgents with OpenClaw's security infrastructure.

## ShellAgent

- **Uses exec-safe-bin-policy.ts:** NO
- **Uses exec-approvals.ts:** NO
- **Command allowlist enforced:** YES (via generic SecurityArbiterInterface)
- **Gap:** ShellAgent uses a custom `checkCommand()` method on `SecurityArbiterInterface`, not the `exec-approvals.ts` runtime approval system. The current implementation is a static whitelist approach (`allowed_commands` + `blocked_patterns`) without integration to:
  - `exec-safe-bin-policy.ts` safe bin profiles
  - `exec-approvals.ts` socket-based approval requests
  - User-interactive approval flows

## FileAgent

- **Path boundaries enforced:** YES (via SecurityArbiterInterface)
- **Default scope:** Configurable via `allowed_paths` policy (e.g., `$HOME`)
- **Gap:** The `securityArbiter` is OPTIONAL in FileAgent (see line 122-127 of `file-agent.ts`). Without it, file operations have no path boundary enforcement. The ShellAgent correctly requires securityArbiter, but FileAgent does not.

## BrowserAgent

- **Playwright sandbox flags:** NOT YET IMPLEMENTED (placeholder implementation)
- **CDP isolated context:** NO
- **Domain allowlist enforced:** YES (via SecurityArbiterInterface.checkDomain)
- **Gap:** BrowserAgent is a foundation/placeholder implementation that doesn't integrate with Playwright's `--no-sandbox` or CDP isolated world features. Domain checks use generic allowlist only.

## Overall Assessment

- **All agents inherit OpenClaw security model:** PARTIAL

### Security Architecture

The SubAgent system uses a layered security model:

```
SubAgents (shell-agent.ts, file-agent.ts, browser-agent.ts)
    |
    v
SecurityArbiterInterface (checkCommand, checkPath, checkDomain, checkPort)
    |
    v
SecurityArbiter (src/security/arbiter.ts) -- static policy approach
    |
    +-- SecurityPolicy (allowed_paths, allowed_commands, etc.)
```

This is SEPARATE from the exec-approvals system:

```
exec-approvals.ts
    |
    +-- Socket-based approval requests
    +-- Allowlist persistence
    +-- User-interactive approval flows
```

### Known Gaps

1. **No exec-approvals integration:** SubAgents use a simple static allowlist approach rather than the runtime approval system in `exec-approvals.ts`. This means:
   - No user-interactive approval prompts for new commands
   - No approval persistence across sessions
   - No integration with `~/.openclaw/exec-approvals.sock`

2. **No exec-safe-bin-policy integration:** ShellAgent doesn't use `exec-safe-bin-policy.ts` which provides:
   - Safe bin profiles with argument validation
   - Denied flag detection
   - Command path resolution

3. **Optional security arbiter in FileAgent:** Unlike ShellAgent which requires securityArbiter, FileAgent silently allows operations if no arbiter is configured.

4. **BrowserAgent is a placeholder:** No actual Playwright integration for sandbox isolation.

### Recommendations

1. Integrate ShellAgent with `exec-approvals.ts` for runtime approval requests
2. Use `exec-safe-bin-policy.ts` for command validation in ShellAgent
3. Make securityArbiter required in FileAgent (like ShellAgent)
4. Implement actual Playwright integration with sandbox flags in BrowserAgent
5. Create a bridge/adapter that connects SecurityArbiter with exec-approvals when interactive approval is needed
