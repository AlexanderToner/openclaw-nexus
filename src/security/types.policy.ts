// src/security/types.policy.ts
/**
 * Security Policy Types
 *
 * Defines the structure of security policies for
 * file operations, shell commands, network access, and skills.
 */

/**
 * Complete security policy configuration.
 */
export interface SecurityPolicy {
  file_operations: FileOperationsPolicy;
  shell_commands: ShellCommandsPolicy;
  network: NetworkPolicy;
  skills: SkillsPolicy;
}

/**
 * Policy for file system operations.
 */
export interface FileOperationsPolicy {
  /** Paths that are allowed for read/write operations */
  allowed_paths: string[];

  /** Paths that are explicitly blocked even if in allowed_paths */
  blocked_paths: string[];

  /** File extensions that are allowed */
  allowed_extensions: string[];

  /** File extensions that are explicitly blocked */
  blocked_extensions: string[];
}

/**
 * Policy for shell command execution.
 */
export interface ShellCommandsPolicy {
  /** Commands that are allowed to execute */
  allowed_commands: string[];

  /** Patterns that block commands even if in allowed_commands */
  blocked_patterns: string[];
}

/**
 * Policy for network access.
 */
export interface NetworkPolicy {
  /** Domains that are allowed for network requests */
  allowed_domains: string[];

  /** Ports that are blocked for security */
  blocked_ports: number[];

  /** Whether localhost connections are allowed */
  allow_localhost: boolean;
}

/**
 * Policy for skill activation.
 */
export interface SkillsPolicy {
  /** Maximum number of skills that can be activated per task */
  max_per_task: number;

  /** Skills that are considered dangerous */
  dangerous_skills: string[];

  /** Whether dangerous skills require user approval */
  dangerous_skills_require_approval: boolean;
}

/**
 * Result of a security check.
 */
export interface SecurityCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;

  /** Reason if not allowed */
  reason?: string;

  /** The policy rule that was applied */
  rule?: string;
}

/**
 * Audit log entry for security decisions.
 */
export interface SecurityAuditEntry {
  /** Timestamp of the check */
  timestamp: number;

  /** Type of operation being checked */
  operation_type: "file" | "shell" | "network" | "skill";

  /** The value being checked (path, command, domain, skill) */
  value: string;

  /** Result of the security check */
  result: SecurityCheckResult;

  /** Task or session ID if available */
  context?: string;
}
