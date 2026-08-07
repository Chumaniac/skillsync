import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import type { VerificationReport } from "../../src/cli/commands/verify";

async function createSkillRoot(blocking = true): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "skillsync-baseline-"));
  const root = join(parent, "review");
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(
    join(root, "SKILL.md"),
    blocking
      ? "---\nname: review\ndescription: Review a change.\n---\nRead [missing](references/missing.md).\n"
      : "---\nname: review\ndescription: Review a change.\n---\n",
  );
  if (blocking) {
    await writeFile(join(root, "scripts", "check.sh"), "#!/bin/sh\necho safe\n", { mode: 0o777 });
    await chmod(join(root, "scripts", "check.sh"), 0o777);
  }
  return root;
}

async function verificationReport(root: string): Promise<VerificationReport> {
  const result = await runCli(["verify", "--path", root, "--target", "codex", "--format", "json"]);
  return JSON.parse(result.stdout) as VerificationReport;
}

describe("skillsync baseline", () => {
  it("creates a digest-only baseline, requires output, and refuses overwrite", async () => {
    const root = await createSkillRoot();
    const output = join(root, "..", "baseline.json");
    const missingOutput = await runCli(["baseline", "--create", "--path", root]);
    expect(missingOutput.exitCode).toBe(1);
    expect(missingOutput.stderr).toContain("baseline --create requires --output");

    const created = await runCli([
      "baseline", "--create", "--path", root, "--output", output, "--target", "codex", "--format", "json",
    ]);
    expect(created.exitCode).toBe(0);
    const baseline = JSON.parse(await readFile(output, "utf8")) as {
      rootDigest: string;
      skills: Array<{ name: string; digest: string }>;
      issues: Array<{ id: string; state: string; reason?: string }>;
    };
    expect(baseline.rootDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(baseline.skills).toEqual([expect.objectContaining({ name: "review", digest: expect.stringMatching(/^sha256:/) })]);
    expect(
      baseline.issues.every((issue) => Object.keys(issue).every((key) => ["id", "state", "reason"].includes(key))),
    ).toBe(true);
    expect(JSON.stringify(baseline)).not.toContain(root);
    expect(JSON.stringify(baseline)).not.toContain("Read [missing]");

    const overwrite = await runCli(["baseline", "--create", "--path", root, "--output", output]);
    expect(overwrite.exitCode).toBe(1);
    expect(overwrite.stderr).toMatch(/EEXIST|exist/i);
  });

  it("rejects output paths inside the direct Skill root before scanning or writing", async () => {
    const root = await createSkillRoot();
    const output = join(root, "baseline.json");

    const created = await runCli([
      "baseline", "--create", "--path", root, "--output", output, "--target", "codex",
    ]);

    expect(created.exitCode).toBe(1);
    expect(created.stderr).toContain("baseline --create output must be outside the direct Skill root.");
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports new, ongoing, resolved, and regressed Issues without hiding ongoing Issues", async () => {
    const root = await createSkillRoot();
    const current = await verificationReport(root);
    const [ongoing, regressed, newIssue] = current.issues;
    if (!ongoing || !regressed || !newIssue) throw new Error("Fixture requires three verification Issues");
    const baselinePath = join(root, "..", "comparison-baseline.json");
    await writeFile(baselinePath, JSON.stringify({
      schema_version: 1,
      rootDigest: `sha256:${"a".repeat(64)}`,
      skills: [],
      issues: [
        ...current.issues
          .filter((issue) => issue.id !== newIssue.id && issue.id !== regressed.id)
          .map((issue) => ({ id: issue.id, state: "open" })),
        { id: regressed.id, state: "resolved" },
        { id: `iss_${"b".repeat(64)}`, state: "open" },
      ],
      profileFingerprint: `sha256:${"c".repeat(64)}`,
      policyFingerprint: `sha256:${"d".repeat(64)}`,
    }));

    const checked = await runCli([
      "baseline", "--check", "--path", root, "--from", baselinePath, "--target", "codex", "--format", "json",
    ]);
    expect(checked.exitCode).toBe(1);
    const report = JSON.parse(checked.stdout) as {
      comparison: { newIds: string[]; ongoingIds: string[]; resolvedIds: string[]; regressedIds: string[] };
    };
    expect(report.comparison.newIds).toEqual([newIssue.id]);
    expect(report.comparison.ongoingIds).toContain(ongoing.id);
    expect(report.comparison.resolvedIds).toEqual([`iss_${"b".repeat(64)}`]);
    expect(report.comparison.regressedIds).toEqual([regressed.id]);
  });

  it("returns zero for policy-allowed new Issues while still reporting comparison IDs", async () => {
    const root = await createSkillRoot(false);
    const current = await verificationReport(root);
    expect(current.exitCode).toBe(0);
    const [allowedIssue] = current.issues;
    if (!allowedIssue) throw new Error("Fixture requires a policy-allowed verification Issue");
    const baselinePath = join(root, "..", "allowed-comparison-baseline.json");
    await writeFile(baselinePath, JSON.stringify({
      schema_version: 1,
      rootDigest: `sha256:${"a".repeat(64)}`,
      skills: [],
      issues: [],
      profileFingerprint: `sha256:${"b".repeat(64)}`,
      policyFingerprint: `sha256:${"c".repeat(64)}`,
    }));

    const checked = await runCli([
      "baseline", "--check", "--path", root, "--from", baselinePath, "--target", "codex", "--format", "json",
    ]);

    expect(checked.exitCode).toBe(0);
    const report = JSON.parse(checked.stdout) as {
      comparison: { newIds: string[]; ongoingIds: string[]; resolvedIds: string[]; regressedIds: string[] };
      exitCode: number;
    };
    expect(report.exitCode).toBe(0);
    expect(report.comparison.newIds).toEqual(current.issues.map((issue) => issue.id).sort());
    expect(report.comparison.newIds).toContain(allowedIssue.id);
    expect(report.comparison.ongoingIds).toEqual([]);
    expect(report.comparison.resolvedIds).toEqual([]);
    expect(report.comparison.regressedIds).toEqual([]);
  });

  it("rejects malformed baseline IDs and digests, including blank ignored reasons", async () => {
    const root = await createSkillRoot();
    const current = await verificationReport(root);
    const issueId = current.issues[0]?.id;
    if (!issueId) throw new Error("Fixture requires a verification Issue");

    const cases = [
      {
        name: "malformed digest",
        baseline: {
          schema_version: 1,
          rootDigest: "sha256:not-a-digest",
          skills: [],
          issues: [],
          profileFingerprint: `sha256:${"a".repeat(64)}`,
          policyFingerprint: `sha256:${"b".repeat(64)}`,
        },
      },
      {
        name: "malformed issue ID",
        baseline: {
          schema_version: 1,
          rootDigest: `sha256:${"a".repeat(64)}`,
          skills: [],
          issues: [{ id: "untrusted-baseline-payload", state: "open" }],
          profileFingerprint: `sha256:${"b".repeat(64)}`,
          policyFingerprint: `sha256:${"c".repeat(64)}`,
        },
      },
      {
        name: "blank ignored reason",
        baseline: {
          schema_version: 1,
          rootDigest: `sha256:${"a".repeat(64)}`,
          skills: [],
          issues: [{ id: issueId, state: "ignored", reason: " " }],
          profileFingerprint: `sha256:${"b".repeat(64)}`,
          policyFingerprint: `sha256:${"c".repeat(64)}`,
        },
      },
    ];

    for (const testCase of cases) {
      const baselinePath = join(root, "..", `${testCase.name}.json`);
      await writeFile(baselinePath, JSON.stringify(testCase.baseline));

      const checked = await runCli(["baseline", "--check", "--path", root, "--from", baselinePath]);

      expect(checked.exitCode).toBe(1);
      expect(checked.stderr).toContain("Invalid baseline file.");
      expect(checked.stdout).toBe("");
    }
  });

  it("returns zero for a clean check and rejects missing files and unsupported formats", async () => {
    const root = await createSkillRoot(false);
    const baselinePath = join(root, "..", "baseline.json");
    const created = await runCli([
      "baseline", "--create", "--path", root, "--output", baselinePath, "--target", "codex",
    ]);
    expect(created.exitCode).toBe(0);

    const clean = await runCli([
      "baseline", "--check", "--path", root, "--from", baselinePath, "--target", "codex", "--format", "text",
    ]);
    expect(clean.exitCode).toBe(0);
    expect(clean.stdout).toContain("Ongoing:");

    const missing = await runCli(["baseline", "--check", "--path", root, "--from", "missing-baseline.json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Cannot read baseline file");

    const unsupported = await runCli([
      "baseline", "--check", "--path", root, "--from", baselinePath, "--format", "sarif",
    ]);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stderr).toContain("Unsupported baseline output format: sarif");
  });
});
