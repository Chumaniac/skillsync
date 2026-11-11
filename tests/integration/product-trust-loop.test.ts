import { access, chmod, cp, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

type VerifyJson = {
  exitCode: number;
  findings: Array<{ code: string }>;
  issues: Array<{
    id: string;
    state: string;
    identity: { code: string; skill: string; evidenceKey: string };
    finding: { code: string; evidence: Array<Record<string, string>> };
    resolutions: Array<{
      kind: string;
      safety?: string;
      changes?: Array<{ path: string; modeBefore?: number; modeAfter?: number; before: string; after: string }>;
    }>;
  }>;
  summary: { fail: number; warn: number; unknown: number };
};

type ActionPlanJson = {
  planDigest: string;
  issueIds: string[];
  changes: Array<{ path: string; safety: string; modeBefore?: number; modeAfter?: number; before: string; after: string }>;
  manualSteps: unknown[];
};

type ApplyReceiptJson = {
  status: string;
  backupPath?: string;
  appliedNotVerified: boolean;
  changedPaths: string[];
};

const fixtureRoot = resolve("fixtures/product/trust-loop/review");

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

function firstIssueId(stdout: string): string {
  const report = parseJson<VerifyJson>(stdout);
  const issue = report.issues.find((candidate) => candidate.identity.code === "structure.invalid-script-mode");
  if (!issue) throw new Error("Expected structure.invalid-script-mode Issue");
  return issue.id;
}

async function writeJsonFile(parent: string, name: string, stdout: string): Promise<string> {
  const path = join(parent, name);
  await writeFile(path, stdout);
  return path;
}

describe("product trust loop", () => {
  it("verifies, explains, plans, applies, re-verifies, and reports without executing Skill scripts", async () => {
    const originalScript = join(fixtureRoot, "scripts", "check.sh");
    const originalContent = await readFile(originalScript, "utf8");
    const originalMode = await mode(originalScript);
    const tempRoot = await mkdtemp(join(tmpdir(), "skillsync-product-trust-loop-"));
    const copyRoot = join(tempRoot, "review");
    const copyScript = join(copyRoot, "scripts", "check.sh");
    const copyMarker = join(copyRoot, "executed.marker");
    const fixtureMarker = join(fixtureRoot, "executed.marker");
    await cp(fixtureRoot, copyRoot, { recursive: true });
    // Normalize the copied fixture so this contract does not depend on a web upload preserving 0777.
    if ((await mode(copyScript)) !== 0o777) {
      await chmod(copyScript, 0o777);
    }

    const before = await runCli(["verify", "--path", copyRoot, "--target", "codex", "--format", "json"]);
    expect(before.exitCode).toBe(1);
    const beforeJson = parseJson<VerifyJson>(before.stdout);
    const issueId = firstIssueId(before.stdout);
    const issue = beforeJson.issues.find((candidate) => candidate.id === issueId);
    expect(issue).toMatchObject({
      state: "open",
      identity: {
        code: "structure.invalid-script-mode",
        skill: "review",
        evidenceKey: '[{"mode":"0777","path":"scripts/check.sh"}]',
      },
      finding: {
        code: "structure.invalid-script-mode",
        evidence: [{ path: "scripts/check.sh", mode: "0777" }],
      },
    });
    expect(beforeJson.findings.map((finding) => finding.code)).toContain("structure.invalid-script-mode");
    await expect(readFile(originalScript, "utf8")).resolves.toBe(originalContent);
    await expect(mode(originalScript)).resolves.toBe(originalMode);

    const explain = await runCli(["explain", issueId, "--path", copyRoot, "--target", "codex", "--format", "json"]);
    expect(explain.exitCode).toBe(0);
    const explainJson = parseJson<typeof issue & { nextSteps: string[] }>(explain.stdout);
    expect(explainJson).toMatchObject({
      id: issueId,
      identity: issue?.identity,
      finding: issue?.finding,
    });
    await expect(access(copyMarker)).rejects.toThrow();

    const planned = await runCli(["fix", "--plan", "--path", copyRoot, "--issue", issueId, "--format", "json"]);
    expect(planned.exitCode).toBe(0);
    const planJson = parseJson<ActionPlanJson>(planned.stdout);
    expect(planJson.issueIds).toEqual([issueId]);
    expect(planJson.changes).toEqual([
      {
        path: "scripts/check.sh",
        before: "",
        after: "",
        safety: "safe",
        modeBefore: 0o777,
        modeAfter: 0o755,
      },
    ]);
    expect(planJson.manualSteps).toEqual([]);
    await expect(readFile(copyScript, "utf8")).resolves.toBe(originalContent);
    await expect(mode(copyScript)).resolves.toBe(0o777);
    await expect(access(join(copyRoot, "fix-plan.json"))).rejects.toThrow();

    const planPath = await writeJsonFile(tempRoot, "explicit-plan.json", planned.stdout);
    const applied = await runCli(["fix", "--apply", "--plan", planPath, "--yes", "--backup", "--format", "json"]);
    expect(applied.exitCode).toBe(0);
    const receiptJson = parseJson<ApplyReceiptJson>(applied.stdout);
    expect(receiptJson).toMatchObject({
      status: "applied",
      appliedNotVerified: true,
      changedPaths: ["scripts/check.sh"],
    });
    expect(receiptJson.backupPath).toEqual(expect.any(String));
    await expect(access(receiptJson.backupPath!)).resolves.toBeUndefined();
    await expect(readFile(copyScript, "utf8")).resolves.toBe(originalContent);
    await expect(mode(copyScript)).resolves.toBe(0o755);

    const after = await runCli(["verify", "--path", copyRoot, "--target", "codex", "--format", "json"]);
    expect(after.exitCode).toBe(0);
    const afterJson = parseJson<VerifyJson>(after.stdout);
    expect(afterJson.issues.filter((candidate) => candidate.identity.code === "structure.invalid-script-mode")).toEqual([]);
    expect(afterJson.summary.fail).toBe(0);

    const beforePath = await writeJsonFile(tempRoot, "before-verify.json", before.stdout);
    const afterPath = await writeJsonFile(tempRoot, "after-verify.json", after.stdout);
    const receiptPath = await writeJsonFile(tempRoot, "apply-receipt.json", applied.stdout);
    const report = await runCli([
      "report",
      "--before",
      beforePath,
      "--after",
      afterPath,
      "--plan",
      planPath,
      "--receipt",
      receiptPath,
      "--format",
      "json",
    ]);
    expect(report.exitCode).toBe(0);
    const reportJson = parseJson<{ conclusion: string; comparison: { resolvedIds: string[] } }>(report.stdout);
    expect(reportJson.conclusion).toBe("verified");
    expect(reportJson.comparison.resolvedIds).toContain(issueId);

    await expect(readFile(originalScript, "utf8")).resolves.toBe(originalContent);
    await expect(mode(originalScript)).resolves.toBe(originalMode);
    await expect(access(copyMarker)).rejects.toThrow();
    await expect(access(fixtureMarker)).rejects.toThrow();
  });
});
