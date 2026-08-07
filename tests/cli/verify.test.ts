import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

describe("skillsync verify", () => {
  it("aggregates structure, compatibility, and provenance findings without executing scripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-verify-"));
    const skillRoot = join(root, "review");
    const marker = join(root, "executed.marker");
    await mkdir(join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review a change\n---\nRead [missing](references/missing.md) and [again](references/missing.md).\n",
    );
    await writeFile(join(skillRoot, "scripts/check.sh"), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });

    const result = await runCli([
      "verify",
      "--path",
      root,
      "--target",
      "codex",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      findings: Array<{ code: string }>;
      issues: Array<{
        id: string;
        identity: { code: string; evidenceKey: string };
        resolutions: Array<{ kind: string; title: string; steps?: string[] }>;
      }>;
      summary: { total: number; fail: number; warn: number; unknown: number };
      reporting: { sarif: boolean; include_local_paths: boolean };
    };
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "structure.missing-reference",
        "provenance.local-only",
      ]),
    );
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(report.summary.warn + report.summary.unknown).toBeGreaterThan(0);
    expect(report.reporting).toEqual({ sarif: true, include_local_paths: false });
    expect(result.stdout).not.toContain(root);
    expect(report.findings.filter((finding) => finding.code === "structure.missing-reference")).toHaveLength(2);
    const missingReferenceIssues = report.issues.filter(
      (issue) => issue.identity.code === "structure.missing-reference",
    );
    expect(missingReferenceIssues).toHaveLength(1);
    expect(missingReferenceIssues[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^iss_[0-9a-f]{64}$/),
        identity: expect.objectContaining({ evidenceKey: '[{"path":"references/missing.md"}]' }),
        resolutions: expect.arrayContaining([
          expect.objectContaining({
            kind: "manual",
            title: "Manually resolve structure.missing-reference",
            steps: expect.arrayContaining([
              "Add the referenced file or remove the broken reference.",
            ]),
          }),
        ]),
      }),
    );
    await expect(access(marker)).rejects.toThrow();
  });

  it("loads an explicit YAML policy and applies its provenance rule", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-verify-policy-"));
    const skillRoot = join(root, "review");
    const policyPath = join(root, "skillsync.policy.yaml");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review a change\n---\n",
    );
    await writeFile(
      policyPath,
      [
        "schema_version: 1",
        "fail_on:",
        "  - unknown-provenance",
        "targets:",
        "  required:",
        "    - codex",
        "capabilities: {}",
        "sources:",
        "  allowed_hosts: []",
        "  require_resolved_commit: false",
        "reporting:",
        "  sarif: true",
        "  include_local_paths: true",
      ].join("\n") + "\n",
    );

    const result = await runCli([
      "verify",
      "--path",
      root,
      "--target",
      "codex",
      "--policy",
      policyPath,
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      findings: Array<{ code: string }>;
      exitCode: number;
      reporting: { sarif: boolean; include_local_paths: boolean };
    };
    expect(report.exitCode).toBe(1);
    expect(report.findings.map((finding) => finding.code)).toContain("provenance.local-only");
    expect(report.reporting).toEqual({ sarif: true, include_local_paths: true });
    expect(result.stdout).toContain(root);
  });

  it("returns policy configuration exit code 2 for an invalid policy file", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-verify-invalid-policy-"));
    const skillRoot = join(root, "review");
    const policyPath = join(root, "invalid.policy.yaml");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review a change\n---\n",
    );
    await writeFile(policyPath, "schema_version: 2\n");

    const result = await runCli([
      "verify",
      "--path",
      root,
      "--target",
      "codex",
      "--policy",
      policyPath,
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(2);
    const report = JSON.parse(result.stdout) as {
      findings: Array<{ code: string }>;
      exitCode: number;
    };
    expect(report.exitCode).toBe(2);
    expect(report.findings.map((finding) => finding.code)).toContain("policy.invalid");
  });
});
