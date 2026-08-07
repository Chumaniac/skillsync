import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import type { VerificationReport } from "../../src/cli/commands/verify";

const VALID_DIGEST = `sha256:${"a".repeat(64)}`;

async function createSkillRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "skillsync-report-"));
  const root = join(parent, "review");
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(
    join(root, "SKILL.md"),
    "---\nname: review\ndescription: Review a change.\n---\nRead [missing](references/missing.md).\n",
  );
  await writeFile(join(root, "scripts", "check.sh"), "#!/bin/sh\necho safe\n", { mode: 0o777 });
  await chmod(join(root, "scripts", "check.sh"), 0o777);
  return root;
}

async function verificationReport(root: string): Promise<VerificationReport> {
  const result = await runCli(["verify", "--path", root, "--target", "codex", "--format", "json"]);
  if (result.exitCode !== 1) {
    throw new Error(`Expected blocking verification fixture, got ${result.exitCode}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as VerificationReport;
}

function validPlanPayload(root: string, issueIds: string[]) {
  return {
    schema_version: 1,
    rootPath: root,
    generatedAt: "2026-08-05T00:00:00.000Z",
    issueIds,
    changes: [{ path: "SKILL.md", before: "before", after: "after", safety: "safe" }],
    manualSteps: [],
    planDigest: VALID_DIGEST,
  };
}

function validReceiptPayload() {
  return {
    schema_version: 1,
    status: "applied",
    planDigest: VALID_DIGEST,
    changedPaths: ["SKILL.md"],
    generatedAt: "2026-08-05T00:01:00.000Z",
  };
}

describe("skillsync report", () => {
  it("classifies issue changes and never verifies a blocking after report", async () => {
    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const [ongoing, resolved, regressed] = source.issues;
    if (!ongoing || !resolved || !regressed) throw new Error("Fixture requires three verification Issues");
    const newIssue = {
      ...ongoing,
      id: `iss_${"f".repeat(64)}`,
      identity: { ...ongoing.identity, code: "report.new" },
    };
    const before: VerificationReport = {
      ...source,
      issues: [ongoing, resolved, { ...regressed, state: "resolved" }],
    };
    const after: VerificationReport = {
      ...source,
      issues: [ongoing, newIssue, regressed],
      exitCode: 1,
    };
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    await writeFile(beforePath, JSON.stringify(before));
    await writeFile(afterPath, JSON.stringify(after));

    const result = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      conclusion: string;
      comparison: { newIds: string[]; ongoingIds: string[]; resolvedIds: string[]; regressedIds: string[] };
    };
    expect(report.conclusion).toBe("not-verified");
    expect(report.comparison).toEqual({
      newIds: [newIssue.id],
      ongoingIds: [ongoing.id],
      resolvedIds: [resolved.id],
      regressedIds: [regressed.id],
    });

    const markdown = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "markdown"]);
    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain(`- New (1): ${newIssue.id}`);
    expect(markdown.stdout).toContain(`- Ongoing (1): ${ongoing.id}`);
    expect(markdown.stdout).toContain(`- Resolved (1): ${resolved.id}`);
    expect(markdown.stdout).toContain(`- Regressed (1): ${regressed.id}`);
    expect(markdown.stdout).toContain("## Issue states");
  });

  it("classifies a retained resolved after-report Issue as resolved instead of ongoing", async () => {
    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const tracked = source.issues[0];
    if (!tracked) throw new Error("Fixture requires a verification Issue");
    const beforeIssue = { ...tracked, state: "open" as const };
    const resolvedIssue = { ...tracked, state: "resolved" as const };
    const before: VerificationReport = { ...source, issues: [beforeIssue] };
    const after: VerificationReport = { ...source, issues: [resolvedIssue], exitCode: 0 };
    const beforePath = join(root, "before-retained-resolved.json");
    const afterPath = join(root, "after-retained-resolved.json");
    await writeFile(beforePath, JSON.stringify(before));
    await writeFile(afterPath, JSON.stringify(after));

    const result = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      comparison: { newIds: string[]; ongoingIds: string[]; resolvedIds: string[]; regressedIds: string[] };
    };
    expect(report.comparison).toEqual({
      newIds: [],
      ongoingIds: [],
      resolvedIds: [tracked.id],
      regressedIds: [],
    });
  });

  it("renders safe Markdown and parseable JSON and SARIF", async () => {
    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const beforePath = join(root, "before-private.json");
    const afterPath = join(root, "after-private.json");
    const planPath = join(root, "plan-private.json");
    const receiptPath = join(root, "receipt-private.json");
    const receiptPayload = {
      schema_version: 1,
      status: "applied",
      planDigest: VALID_DIGEST,
      changedPaths: ["SKILL.md"],
      backupPath: root,
      generatedAt: "2026-08-05T00:01:00.000Z",
    };
    await writeFile(beforePath, JSON.stringify(source));
    await writeFile(afterPath, JSON.stringify({ ...source, exitCode: 0, issues: [] }));
    await writeFile(planPath, JSON.stringify({
      schema_version: 1,
      rootPath: root,
      generatedAt: "2026-08-05T00:00:00.000Z",
      issueIds: source.issues.map((issue) => issue.id),
      changes: [{ path: "SKILL.md", before: "private source", after: "private replacement", safety: "safe" }],
      manualSteps: [],
      planDigest: VALID_DIGEST,
    }));
    await writeFile(receiptPath, JSON.stringify(receiptPayload));

    const markdown = await runCli([
      "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--receipt", receiptPath,
      "--format", "markdown",
    ]);
    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain("Conclusion: verified");
    expect(markdown.stdout).toContain("Verification report digest:");
    expect(markdown.stdout).not.toContain(root);
    expect(markdown.stdout).not.toContain("private source");
    expect(markdown.stdout).not.toContain("private replacement");

    const rawReceiptReport = await runCli([
      "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--receipt", receiptPath,
      "--format", "json",
    ]);
    expect(rawReceiptReport.exitCode).toBe(0);

    await writeFile(receiptPath, JSON.stringify({
      ...receiptPayload,
      appliedNotVerified: true,
      nextCommand: "skillsync verify",
    }));
    const fixApplyReceiptReport = await runCli([
      "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--receipt", receiptPath,
      "--format", "json",
    ]);
    expect(fixApplyReceiptReport.exitCode).toBe(0);
    expect(JSON.parse(fixApplyReceiptReport.stdout).applyReceiptDigest).toBe(
      JSON.parse(rawReceiptReport.stdout).applyReceiptDigest,
    );

    const json = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "json"]);
    expect(JSON.parse(json.stdout).conclusion).toBe("verified");

    const sarif = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "sarif"]);
    const parsedSarif = JSON.parse(sarif.stdout) as {
      version: string;
      runs: Array<{ results: Array<{ properties: { issueId: string; before: string; after: string } }> }>;
    };
    expect(parsedSarif.version).toBe("2.1.0");
    expect(parsedSarif.runs[0]?.results[0]?.properties.issueId).toMatch(/^iss_/);
  });

  it("rejects missing inputs and unsupported formats with stable errors", async () => {
    const missing = await runCli([
      "report", "--before", "missing-before.json", "--after", "missing-after.json", "--format", "markdown",
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Cannot read verification report");

    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    await writeFile(beforePath, JSON.stringify(source));
    await writeFile(afterPath, JSON.stringify(source));
    const unsupported = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "text"]);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stderr).toContain("Unsupported report output format: text");
  });

  it("rejects malformed report IDs, targets, and plan or receipt digests before rendering", async () => {
    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    const planPath = join(root, "plan.json");
    const receiptPath = join(root, "receipt.json");
    await writeFile(beforePath, JSON.stringify(source));

    await writeFile(afterPath, JSON.stringify({
      ...source,
      issues: [{ ...source.issues[0], id: "untrusted-report-payload" }],
    }));
    const malformedIssue = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "json"]);
    expect(malformedIssue.exitCode).toBe(1);
    expect(malformedIssue.stderr).toContain("Invalid verification report.");
    expect(malformedIssue.stdout).not.toContain("untrusted-report-payload");

    await writeFile(afterPath, JSON.stringify({ ...source, targets: [{}] }));
    const malformedTargets = await runCli(["report", "--before", beforePath, "--after", afterPath, "--format", "json"]);
    expect(malformedTargets.exitCode).toBe(1);
    expect(malformedTargets.stderr).toContain("Invalid verification report.");

    await writeFile(afterPath, JSON.stringify(source));
    await writeFile(planPath, JSON.stringify({ planDigest: "untrusted-plan-payload" }));
    const malformedPlan = await runCli([
      "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--format", "markdown",
    ]);
    expect(malformedPlan.exitCode).toBe(1);
    expect(malformedPlan.stderr).toContain("Invalid ActionPlan.");
    expect(malformedPlan.stdout).not.toContain("untrusted-plan-payload");

    await writeFile(planPath, JSON.stringify(validPlanPayload(root, source.issues.map((issue) => issue.id))));
    await writeFile(receiptPath, JSON.stringify({ planDigest: "untrusted-receipt-payload" }));
    const malformedReceipt = await runCli([
      "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--receipt", receiptPath,
      "--format", "markdown",
    ]);
    expect(malformedReceipt.exitCode).toBe(1);
    expect(malformedReceipt.stderr).toContain("Invalid ApplyReceipt.");
    expect(malformedReceipt.stdout).not.toContain("untrusted-receipt-payload");
  });

  it("rejects digest-shaped structurally invalid ActionPlan payloads without echoing payload markers", async () => {
    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    const planPath = join(root, "plan.json");
    await writeFile(beforePath, JSON.stringify(source));
    await writeFile(afterPath, JSON.stringify(source));

    const validPlan = validPlanPayload(root, source.issues.map((issue) => issue.id));
    const issueId = source.issues[0]?.id;
    if (!issueId) throw new Error("Fixture requires a verification Issue");

    const cases: Array<{ name: string; marker: string; payload: unknown }> = [
      {
        name: "missing required fields",
        marker: "secret-plan-missing-marker",
        payload: { planDigest: VALID_DIGEST, marker: "secret-plan-missing-marker" },
      },
      {
        name: "unsafe change path",
        marker: "secret-plan-path-marker",
        payload: {
          ...validPlan,
          changes: [{ path: "secret-plan-path-marker/../SKILL.md", before: "before", after: "after", safety: "safe" }],
        },
      },
      {
        name: "wrong mode type",
        marker: "secret-plan-mode-marker",
        payload: {
          ...validPlan,
          changes: [{
            path: "SKILL.md",
            before: "secret-plan-mode-marker",
            after: "after",
            safety: "safe",
            modeBefore: "0644",
          }],
        },
      },
      {
        name: "malformed manual step",
        marker: "secret-plan-manual-marker",
        payload: {
          ...validPlan,
          manualSteps: [{ issueId, title: "Manual step", steps: ["secret-plan-manual-marker", 42] }],
        },
      },
    ];

    for (const item of cases) {
      await writeFile(planPath, JSON.stringify(item.payload));
      const result = await runCli([
        "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--format", "markdown",
      ]);
      expect(result.exitCode, item.name).toBe(1);
      expect(result.stderr, item.name).toContain("Invalid ActionPlan.");
      expect(result.stdout, item.name).not.toContain(item.marker);
      expect(result.stderr, item.name).not.toContain(item.marker);
    }
  });

  it("rejects digest-shaped structurally invalid ApplyReceipt payloads without echoing payload markers", async () => {
    const root = await createSkillRoot();
    const source = await verificationReport(root);
    const beforePath = join(root, "before.json");
    const afterPath = join(root, "after.json");
    const planPath = join(root, "plan.json");
    const receiptPath = join(root, "receipt.json");
    await writeFile(beforePath, JSON.stringify(source));
    await writeFile(afterPath, JSON.stringify(source));
    await writeFile(planPath, JSON.stringify(validPlanPayload(root, source.issues.map((issue) => issue.id))));

    const validReceipt = validReceiptPayload();
    const cases: Array<{ name: string; marker: string; payload: unknown }> = [
      {
        name: "missing required fields",
        marker: "secret-receipt-missing-marker",
        payload: { planDigest: VALID_DIGEST, marker: "secret-receipt-missing-marker" },
      },
      {
        name: "unsafe changed path",
        marker: "secret-receipt-path-marker",
        payload: { ...validReceipt, changedPaths: ["secret-receipt-path-marker/../SKILL.md"] },
      },
      {
        name: "wrong optional type",
        marker: "secret-receipt-backup-marker",
        payload: { ...validReceipt, backupPath: { marker: "secret-receipt-backup-marker" } },
      },
      {
        name: "wrong appliedNotVerified type",
        marker: "secret-receipt-applied-marker",
        payload: { ...validReceipt, appliedNotVerified: "secret-receipt-applied-marker" },
      },
      {
        name: "wrong nextCommand string",
        marker: "secret-receipt-command-marker",
        payload: { ...validReceipt, nextCommand: "secret-receipt-command-marker" },
      },
      {
        name: "non-string nextCommand",
        marker: "secret-receipt-command-type-marker",
        payload: { ...validReceipt, nextCommand: { marker: "secret-receipt-command-type-marker" } },
      },
      {
        name: "unknown top-level field",
        marker: "secret-receipt-extra-marker",
        payload: { ...validReceipt, extra: "secret-receipt-extra-marker" },
      },
    ];

    for (const item of cases) {
      await writeFile(receiptPath, JSON.stringify(item.payload));
      const result = await runCli([
        "report", "--before", beforePath, "--after", afterPath, "--plan", planPath, "--receipt", receiptPath,
        "--format", "markdown",
      ]);
      expect(result.exitCode, item.name).toBe(1);
      expect(result.stderr, item.name).toContain("Invalid ApplyReceipt.");
      expect(result.stdout, item.name).not.toContain(item.marker);
      expect(result.stderr, item.name).not.toContain(item.marker);
    }
  });
});
