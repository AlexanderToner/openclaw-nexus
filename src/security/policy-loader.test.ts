import * as fs from "fs/promises";
import * as path from "path";
// src/security/policy-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PolicyLoader } from "./policy-loader.js";

describe("PolicyLoader", () => {
  const testDir = "/tmp/policy-loader-test";
  const policyFile = path.join(testDir, "security_policy.yaml");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("loads policy from YAML file", async () => {
    const yamlContent = `
file_operations:
  allowed_paths:
    - "~/Desktop"
    - "~/Documents"
  blocked_paths:
    - "/etc"
    - "~/.ssh"
  allowed_extensions: []
  blocked_extensions: []

shell_commands:
  allowed_commands:
    - "ls"
    - "cat"
  blocked_patterns:
    - "rm -rf /"

network:
  allowed_domains:
    - "github.com"
  blocked_ports: [22, 23]
  allow_localhost: true

skills:
  max_per_task: 5
  dangerous_skills: []
  dangerous_skills_require_approval: false
`;

    await fs.writeFile(policyFile, yamlContent);

    const loader = new PolicyLoader();
    const policy = await loader.load(policyFile);

    expect(policy.file_operations.allowed_paths).toContain("~/Desktop");
    expect(policy.file_operations.blocked_paths).toContain("/etc");
    expect(policy.shell_commands.allowed_commands).toContain("ls");
    expect(policy.network.allowed_domains).toContain("github.com");
    expect(policy.skills.max_per_task).toBe(5);
  });

  it("returns default policy when file not found", async () => {
    const loader = new PolicyLoader();
    const policy = await loader.load("/nonexistent/policy.yaml");

    expect(policy).toBeDefined();
    expect(policy.skills.max_per_task).toBeGreaterThan(0);
  });

  it("validates required policy fields", async () => {
    const invalidYaml = `
file_operations:
  allowed_paths: []
`;

    await fs.writeFile(policyFile, invalidYaml);

    const loader = new PolicyLoader();
    const policy = await loader.load(policyFile);

    // Should have defaults for missing fields
    expect(policy.shell_commands).toBeDefined();
    expect(policy.network).toBeDefined();
    expect(policy.skills).toBeDefined();
  });
});
