// src/security/arbiter.ts
/**
 * Security Arbiter
 *
 * Performs pre-execution security checks to block dangerous operations
 * before they are executed. This is a critical component that enforces
 * the security policy.
 *
 * Key difference from post-audit:
 * - Old approach: Operation executes, then logged for audit
 * - New approach: Operation checked BEFORE execution, blocked if unsafe
 */

import type { SecurityPolicy, SecurityCheckResult, SecurityAuditEntry } from "./types.policy";

/**
 * SecurityArbiter enforces security policy through pre-execution checks.
 *
 * All operations (file, shell, network, skill) must pass through
 * the arbiter before execution. Blocked operations return a
 * SecurityCheckResult with allowed=false and a reason.
 */
export class SecurityArbiter {
  private policy: SecurityPolicy;
  private auditLog: SecurityAuditEntry[] = [];

  constructor(policy: SecurityPolicy) {
    this.policy = policy;
  }

  /**
   * Check if a file path is allowed for operations.
   *
   * @param path - The file path to check
   * @returns SecurityCheckResult indicating if path is allowed
   */
  checkPath(path: string): SecurityCheckResult {
    const expandedPath = this.expandPath(path);

    // Check blocked paths first (highest priority)
    for (const blocked of this.policy.file_operations.blocked_paths) {
      const expandedBlocked = this.expandPath(blocked);
      if (expandedPath.startsWith(expandedBlocked)) {
        this.audit("file", path, false, "blocked_path");
        return {
          allowed: false,
          reason: `Path '${path}' is in blocked paths`,
          rule: "blocked_path",
        };
      }
    }

    // Check allowed paths
    const isAllowed = this.policy.file_operations.allowed_paths.some((allowed) => {
      const expandedAllowed = this.expandPath(allowed);
      return expandedPath.startsWith(expandedAllowed);
    });

    if (!isAllowed) {
      this.audit("file", path, false, "not_allowed_path");
      return {
        allowed: false,
        reason: `Path '${path}' is not in allowed paths`,
        rule: "not_allowed_path",
      };
    }

    // Check blocked extensions
    const ext = this.getExtension(path);
    if (ext && this.policy.file_operations.blocked_extensions.includes(ext)) {
      this.audit("file", path, false, "blocked_extension");
      return {
        allowed: false,
        reason: `File extension '${ext}' is blocked`,
        rule: "blocked_extension",
      };
    }

    // Check allowed extensions (if specified)
    if (this.policy.file_operations.allowed_extensions.length > 0) {
      if (ext && !this.policy.file_operations.allowed_extensions.includes(ext)) {
        this.audit("file", path, false, "not_allowed_extension");
        return {
          allowed: false,
          reason: `File extension '${ext}' is not in allowed extensions`,
          rule: "not_allowed_extension",
        };
      }
    }

    this.audit("file", path, true, "allowed");
    return { allowed: true };
  }

  /**
   * Check if a shell command is allowed to execute.
   *
   * @param command - The command to check
   * @returns SecurityCheckResult indicating if command is allowed
   */
  checkCommand(command: string): SecurityCheckResult {
    const trimmed = command.trim();
    const baseCommand = trimmed.split(/\s+/)[0];

    // Check blocked patterns first (highest priority)
    for (const pattern of this.policy.shell_commands.blocked_patterns) {
      if (trimmed.includes(pattern)) {
        this.audit("shell", command, false, "blocked_pattern");
        return {
          allowed: false,
          reason: `Command matches blocked pattern: '${pattern}'`,
          rule: "blocked_pattern",
        };
      }
    }

    // Check allowed commands
    const isAllowed = this.policy.shell_commands.allowed_commands.some(
      (allowed) => baseCommand === allowed || trimmed.startsWith(allowed + " ")
    );

    if (!isAllowed) {
      this.audit("shell", command, false, "not_allowed_command");
      return {
        allowed: false,
        reason: `Command '${baseCommand}' is not in allowed commands`,
        rule: "not_allowed_command",
      };
    }

    this.audit("shell", command, true, "allowed");
    return { allowed: true };
  }

  /**
   * Check if a network domain is allowed.
   *
   * @param domain - The domain to check
   * @returns SecurityCheckResult indicating if domain is allowed
   */
  checkDomain(domain: string): SecurityCheckResult {
    // Check localhost
    if (domain === "localhost" || domain === "127.0.0.1" || domain.startsWith("127.")) {
      if (!this.policy.network.allow_localhost) {
        this.audit("network", domain, false, "localhost_blocked");
        return {
          allowed: false,
          reason: "Localhost connections are not allowed",
          rule: "localhost_blocked",
        };
      }
      this.audit("network", domain, true, "localhost_allowed");
      return { allowed: true };
    }

    // Check allowed domains
    const isAllowed = this.policy.network.allowed_domains.some(
      (allowed) => domain === allowed || domain.endsWith("." + allowed)
    );

    if (!isAllowed) {
      this.audit("network", domain, false, "not_allowed_domain");
      return {
        allowed: false,
        reason: `Domain '${domain}' is not in allowed domains`,
        rule: "not_allowed_domain",
      };
    }

    this.audit("network", domain, true, "allowed");
    return { allowed: true };
  }

  /**
   * Check if a port is allowed for network connections.
   *
   * @param port - The port number to check
   * @returns SecurityCheckResult indicating if port is allowed
   */
  checkPort(port: number): SecurityCheckResult {
    if (this.policy.network.blocked_ports.includes(port)) {
      this.audit("network", `port:${port}`, false, "blocked_port");
      return {
        allowed: false,
        reason: `Port ${port} is blocked`,
        rule: "blocked_port",
      };
    }

    this.audit("network", `port:${port}`, true, "allowed");
    return { allowed: true };
  }

  /**
   * Check if a skill is allowed to be activated.
   *
   * @param skillName - The skill name to check
   * @returns SecurityCheckResult indicating if skill is allowed
   */
  checkSkill(skillName: string): SecurityCheckResult {
    const isDangerous = this.policy.skills.dangerous_skills.includes(skillName);

    if (isDangerous && this.policy.skills.dangerous_skills_require_approval) {
      this.audit("skill", skillName, false, "dangerous_skill_requires_approval");
      return {
        allowed: false,
        reason: `Skill '${skillName}' is dangerous and requires user approval`,
        rule: "dangerous_skill_requires_approval",
      };
    }

    this.audit("skill", skillName, true, "allowed");
    return { allowed: true };
  }

  /**
   * Expand path with home directory.
   */
  private expandPath(path: string): string {
    if (path.startsWith("~/")) {
      return path.replace("~", process.env.HOME ?? "~");
    }
    return path;
  }

  /**
   * Get file extension from path.
   */
  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf(".");
    const lastSlash = path.lastIndexOf("/");
    if (lastDot > lastSlash && lastDot !== -1) {
      return path.slice(lastDot);
    }
    return "";
  }

  /**
   * Add an entry to the audit log.
   */
  private audit(
    operationType: SecurityAuditEntry["operation_type"],
    value: string,
    allowed: boolean,
    rule: string
  ): void {
    this.auditLog.push({
      timestamp: Date.now(),
      operation_type: operationType,
      value,
      result: {
        allowed,
        rule,
        reason: allowed ? undefined : `Blocked by rule: ${rule}`,
      },
    });
  }

  /**
   * Get the audit log.
   */
  getAuditLog(): SecurityAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Clear the audit log.
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }
}