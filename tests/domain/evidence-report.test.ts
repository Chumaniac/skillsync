import { describe, expect, it } from "vitest";

import { createBaseline } from "../../src/domain/baseline";
import { createEvidenceReport } from "../../src/domain/evidence-report";
import { toIssue } from "../../src/domain/issue";
import type { ActionPlan } from "../../src/domain/action-plan";
import type { Issue, IssueState } from "../../src/domain/issue";
import type { ApplyReceipt } from "../../src/domain/patch-application";
import type { Finding } from "../../src/domain/result";

function issue(code: string, state: IssueState = "open"): Issue {
  const finding: Finding = {
    level: 1,
    severity: "warn",
    status: "warn",
    code,
    skill: "review",
    message: `private message for ${code}`,
    remediation: `private remediation for ${code}`,
    evidence: [{ path: "/workspace/skillsync/private/SKILL.md", content: `private file contents for ${code}` }],
  };

  return { ...toIssue(finding, { targetRoot: "/workspace/skillsync" }), state };
}

describe("EvidenceReport", () => {
  it("derives verified exclusively from the after exit code", () => {
    const before = {
      issues: [],
      exitCode: 1 as const,
      rootDigest: "sha256:before-root",
      verificationReportDigest: "sha256:before-report",
    };
    const after = {
      issues: [],
      exitCode: 0 as const,
      rootDigest: "sha256:after-root",
      verificationReportDigest: "sha256:after-report",
    };

    expect(createEvidenceReport({ before, after, toolVersion: "0.1.0" }).conclusion).toBe("verified");
    expect(createEvidenceReport({ before, after: { ...after, exitCode: 2 }, toolVersion: "0.1.0" }).conclusion).toBe("not-verified");
  });

  it("records sorted absent and issue states with plan and canonical receipt digests", () => {
    const beforeOnly = issue("before-only", "acknowledged");
    const ongoing = issue("ongoing", "open");
    const afterOnly = issue("after-only", "resolved");
    const plan: ActionPlan = {
      schema_version: 1,
      rootPath: "/workspace/skillsync/private",
      generatedAt: "2026-08-05T00:00:00.000Z",
      issueIds: [ongoing.id],
      changes: [{ path: "SKILL.md", before: "private before", after: "private after", safety: "safe" }],
      manualSteps: [],
      planDigest: "sha256:plan-digest",
    };
    const receipt: ApplyReceipt = {
      schema_version: 1,
      status: "applied",
      planDigest: plan.planDigest,
      changedPaths: ["SKILL.md"],
      backupPath: "/workspace/skillsync/private/backup",
      generatedAt: "2026-08-05T00:01:00.000Z",
    };
    const before = {
      issues: [ongoing, beforeOnly],
      exitCode: 1 as const,
      rootDigest: "sha256:before-root",
      verificationReportDigest: "sha256:before-report",
    };
    const after = {
      issues: [afterOnly, ongoing],
      exitCode: 0 as const,
      rootDigest: "sha256:after-root",
      verificationReportDigest: "sha256:after-report",
    };
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);
    const report = createEvidenceReport({
      before,
      after,
      plan,
      receipt,
      baseline: createBaseline({
        rootDigest: "sha256:root",
        skills: [],
        issues: [{ ...afterOnly, state: "resolved" }],
        profileFingerprint: "sha256:profile",
        policyFingerprint: "sha256:policy",
      }),
      toolVersion: "0.1.0",
    });

    expect(report).toMatchObject({
      schema_version: 1,
      conclusion: "verified",
      toolVersion: "0.1.0",
      rootDigest: "sha256:after-root",
      verificationReportDigest: "sha256:after-report",
      planDigest: "sha256:plan-digest",
      applyReceiptDigest: "sha256:118f80c87c3366e6a9fd83842a2b6fce3277c3de9f321963969a78670db0ef59",
      comparison: {
        newIds: [],
        ongoingIds: [ongoing.id],
        resolvedIds: [beforeOnly.id],
        regressedIds: [afterOnly.id],
      },
    });
    expect(report.issueStates).toEqual([
      { id: afterOnly.id, before: "absent", after: "resolved" },
      { id: beforeOnly.id, before: "acknowledged", after: "absent" },
      { id: ongoing.id, before: "open", after: "open" },
    ].sort((left, right) => left.id.localeCompare(right.id)));
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });

  it("does not serialize paths or finding content from snapshots, plans, or receipts", () => {
    const privateIssue = issue("private-issue");
    const report = createEvidenceReport({
      before: {
        issues: [privateIssue],
        exitCode: 1,
        rootDigest: "sha256:before",
        verificationReportDigest: "sha256:before-report",
      },
      after: {
        issues: [],
        exitCode: 0,
        rootDigest: "sha256:after",
        verificationReportDigest: "sha256:after-report",
      },
      plan: {
        schema_version: 1,
        rootPath: "/workspace/skillsync/private",
        generatedAt: "2026-08-05T00:00:00.000Z",
        issueIds: [privateIssue.id],
        changes: [{ path: "SKILL.md", before: "private before", after: "private after", safety: "safe" }],
        manualSteps: [],
        planDigest: "sha256:plan",
      },
      receipt: {
        schema_version: 1,
        status: "applied",
        planDigest: "sha256:plan",
        changedPaths: ["SKILL.md"],
        backupPath: "/workspace/skillsync/private/backup",
        generatedAt: "2026-08-05T00:01:00.000Z",
      },
      toolVersion: "0.1.0",
    });
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain("/workspace/skillsync");
    expect(serialized).not.toContain("private message");
    expect(serialized).not.toContain("private remediation");
    expect(serialized).not.toContain("private file contents");
    expect(serialized).not.toContain("private before");
    expect(serialized).not.toContain("private after");
  });
});
