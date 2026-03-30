// src/security/policy-loader.ts
/**
 * Security Policy Loader
 *
 * Loads security policies from YAML configuration files.
 * Falls back to safe defaults when file is missing or invalid.
 */

import * as fs from "fs/promises";
import type { SecurityPolicy, FileOperationsPolicy, ShellCommandsPolicy, NetworkPolicy, SkillsPolicy } from "./types.policy";

/**
 * Default security policy with safe defaults.
 * This is used when no policy file is provided or when loading fails.
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  file_operations: {
    allowed_paths: [
      "~/Desktop",
      "~/Documents",
      "~/Downloads",
      "/tmp/openclaw-workspace",
    ],
    blocked_paths: [
      "/etc",
      "/System",
      "~/.ssh",
      "~/.gnupg",
    ],
    allowed_extensions: [".txt", ".md", ".pdf", ".jpg", ".png", ".csv", ".json", ".log"],
    blocked_extensions: [".exe", ".sh", ".bat", ".vbs"],
  },
  shell_commands: {
    allowed_commands: ["ls", "cat", "mkdir", "cp", "mv", "rm"],
    blocked_patterns: [
      "rm -rf /",
      "sudo",
      "chmod 777",
      "dd if=",
    ],
  },
  network: {
    allowed_domains: [
      "github.com",
      "raw.githubusercontent.com",
      "api.openai.com",
      "api.anthropic.com",
    ],
    blocked_ports: [22, 23, 445, 3389],
    allow_localhost: true,
  },
  skills: {
    max_per_task: 5,
    dangerous_skills: ["delete_files", "send_email", "post_http"],
    dangerous_skills_require_approval: true,
  },
};

/**
 * PolicyLoader loads and validates security policies from YAML files.
 */
export class PolicyLoader {
  private cache: Map<string, SecurityPolicy> = new Map();

  /**
   * Load a security policy from a YAML file.
   *
   * @param filePath - Path to the YAML policy file
   * @returns SecurityPolicy object
   */
  async load(filePath: string): Promise<SecurityPolicy> {
    // Check cache first
    const cached = this.cache.get(filePath);
    if (cached) return cached;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const policy = this.parseYaml(content);
      const validated = this.validateAndFillDefaults(policy);
      this.cache.set(filePath, validated);
      return validated;
    } catch {
      // File not found or parse error - return defaults
      console.warn(`[PolicyLoader] Could not load policy from ${filePath}, using defaults`);
      return { ...DEFAULT_SECURITY_POLICY };
    }
  }

  /**
   * Parse YAML content into a policy object.
   * Simple YAML parser for our use case.
   */
  private parseYaml(content: string): Partial<SecurityPolicy> {
    const result: Partial<SecurityPolicy> = {};
    const lines = content.split("\n");
    let currentSection: string | null = null;
    let currentArray: string[] | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Section header (e.g., "file_operations:")
      if (!trimmed.startsWith("-") && trimmed.endsWith(":")) {
        currentSection = trimmed.slice(0, -1);
        currentArray = null;
        continue;
      }

      // Array item (e.g., "- \"~/Desktop\"")
      if (trimmed.startsWith("- ")) {
        const value = trimmed.slice(2).replace(/^["']|["']$/g, "");

        if (currentSection) {
          // Initialize section if needed
          if (!result[currentSection as keyof SecurityPolicy]) {
            result[currentSection as keyof SecurityPolicy] = this.createEmptySection(currentSection);
          }

          const section = result[currentSection as keyof SecurityPolicy] as Record<string, unknown>;

          // Find the array to add to (look for last key assignment)
          if (currentArray && section[currentArray]) {
            (section[currentArray] as string[]).push(value);
          }
        }
        continue;
      }

      // Key-value pair (e.g., "max_per_task: 5")
      if (trimmed.includes(": ")) {
        const [key, value] = trimmed.split(": ");
        const parsedValue = this.parseValue(value);

        if (currentSection) {
          if (!result[currentSection as keyof SecurityPolicy]) {
            result[currentSection as keyof SecurityPolicy] = this.createEmptySection(currentSection);
          }

          const section = result[currentSection as keyof SecurityPolicy] as Record<string, unknown>;
          section[key] = parsedValue;
          currentArray = Array.isArray(parsedValue) ? key : null;
        }
      }
    }

    return result;
  }

  /**
   * Parse a YAML value.
   */
  private parseValue(value: string): string | number | boolean | string[] | number[] {
    // Boolean
    if (value === "true") return true;
    if (value === "false") return false;

    // Number
    if (/^-?\d+$/.test(value)) return parseInt(value, 10);

    // Array (e.g., "[22, 23]")
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];

      const items = inner.split(",").map((s) => s.trim());
      if (items.every((s) => /^-?\d+$/.test(s))) {
        return items.map((s) => parseInt(s, 10));
      }
      return items.map((s) => s.replace(/^["']|["']$/g, ""));
    }

    // String (remove quotes)
    return value.replace(/^["']|["']$/g, "");
  }

  /**
   * Create an empty section based on section name.
   */
  private createEmptySection(section: string): FileOperationsPolicy | ShellCommandsPolicy | NetworkPolicy | SkillsPolicy {
    switch (section) {
      case "file_operations":
        return { allowed_paths: [], blocked_paths: [], allowed_extensions: [], blocked_extensions: [] };
      case "shell_commands":
        return { allowed_commands: [], blocked_patterns: [] };
      case "network":
        return { allowed_domains: [], blocked_ports: [], allow_localhost: true };
      case "skills":
        return { max_per_task: 5, dangerous_skills: [], dangerous_skills_require_approval: false };
      default:
        return {} as never;
    }
  }

  /**
   * Validate policy and fill in defaults for missing fields.
   */
  private validateAndFillDefaults(policy: Partial<SecurityPolicy>): SecurityPolicy {
    return {
      file_operations: {
        ...DEFAULT_SECURITY_POLICY.file_operations,
        ...policy.file_operations,
      },
      shell_commands: {
        ...DEFAULT_SECURITY_POLICY.shell_commands,
        ...policy.shell_commands,
      },
      network: {
        ...DEFAULT_SECURITY_POLICY.network,
        ...policy.network,
      },
      skills: {
        ...DEFAULT_SECURITY_POLICY.skills,
        ...policy.skills,
      },
    };
  }

  /**
   * Clear the policy cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}