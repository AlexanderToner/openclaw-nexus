// src/security/arbiter.test.ts
import { describe, it, expect } from "vitest";
import { SecurityArbiter } from "./arbiter";
import type { SecurityPolicy } from "./types.policy";

describe("SecurityArbiter", () => {
  const createTestPolicy = (): SecurityPolicy => ({
    file_operations: {
      allowed_paths: ["~/Desktop", "~/Documents"],
      blocked_paths: ["/etc", "~/.ssh"],
      allowed_extensions: [".txt", ".md"],
      blocked_extensions: [".exe"],
    },
    shell_commands: {
      allowed_commands: ["ls", "cat", "rm"],
      blocked_patterns: ["rm -rf /", "sudo"],
    },
    network: {
      allowed_domains: ["github.com", "api.openai.com"],
      blocked_ports: [22, 445],
      allow_localhost: true,
    },
    skills: {
      max_per_task: 5,
      dangerous_skills: ["delete_files", "send_email"],
      dangerous_skills_require_approval: true,
    },
  });

  describe("checkPath", () => {
    it("allows paths in allowed_paths", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkPath("~/Desktop/test.txt").allowed).toBe(true);
      expect(arbiter.checkPath("~/Documents/notes.md").allowed).toBe(true);
    });

    it("blocks paths in blocked_paths", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkPath("/etc/passwd").allowed).toBe(false);
      expect(arbiter.checkPath("~/.ssh/id_rsa").allowed).toBe(false);
    });

    it("blocks blocked_paths even if in allowed_paths", () => {
      const policy = createTestPolicy();
      policy.file_operations.allowed_paths.push("~/.ssh");
      const arbiter = new SecurityArbiter(policy);

      // blocked_paths takes precedence
      expect(arbiter.checkPath("~/.ssh/config").allowed).toBe(false);
    });

    it("blocks paths with blocked extensions", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkPath("~/Desktop/malware.exe").allowed).toBe(false);
    });

    it("allows paths with allowed extensions", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkPath("~/Desktop/notes.txt").allowed).toBe(true);
      expect(arbiter.checkPath("~/Desktop/readme.md").allowed).toBe(true);
    });
  });

  describe("checkCommand", () => {
    it("allows commands in allowed_commands", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkCommand("ls").allowed).toBe(true);
      expect(arbiter.checkCommand("cat").allowed).toBe(true);
    });

    it("blocks commands not in allowed_commands", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkCommand("sudo").allowed).toBe(false);
      expect(arbiter.checkCommand("rm -rf /").allowed).toBe(false);
    });

    it("blocks commands matching blocked_patterns", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkCommand("rm -rf /").allowed).toBe(false);
      expect(arbiter.checkCommand("sudo ls").allowed).toBe(false);
    });

    it("allows partial matches in allowed_commands", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkCommand("ls -la").allowed).toBe(true);
      expect(arbiter.checkCommand("cat file.txt").allowed).toBe(true);
    });
  });

  describe("checkDomain", () => {
    it("allows domains in allowed_domains", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkDomain("github.com").allowed).toBe(true);
      expect(arbiter.checkDomain("api.openai.com").allowed).toBe(true);
    });

    it("blocks domains not in allowed_domains", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkDomain("malware.com").allowed).toBe(false);
    });

    it("allows localhost when allow_localhost is true", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkDomain("localhost").allowed).toBe(true);
      expect(arbiter.checkDomain("127.0.0.1").allowed).toBe(true);
    });

    it("blocks localhost when allow_localhost is false", () => {
      const policy = createTestPolicy();
      policy.network.allow_localhost = false;
      const arbiter = new SecurityArbiter(policy);

      expect(arbiter.checkDomain("localhost").allowed).toBe(false);
    });
  });

  describe("checkSkill", () => {
    it("allows non-dangerous skills", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkSkill("read_file").allowed).toBe(true);
      expect(arbiter.checkSkill("list_directory").allowed).toBe(true);
    });

    it("flags dangerous skills as requiring approval", () => {
      const arbiter = new SecurityArbiter(createTestPolicy());

      expect(arbiter.checkSkill("delete_files").allowed).toBe(false);
      expect(arbiter.checkSkill("delete_files").reason).toContain("approval");
    });

    it("allows dangerous skills when approval not required", () => {
      const policy = createTestPolicy();
      policy.skills.dangerous_skills_require_approval = false;
      const arbiter = new SecurityArbiter(policy);

      expect(arbiter.checkSkill("delete_files").allowed).toBe(true);
    });
  });
});