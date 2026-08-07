import { describe, expect, it } from "vitest";

import { createActionPlan, planDigest, sortPatchChanges } from "../../src/domain/action-plan.js";
import type { PatchChange } from "../../src/domain/resolution.js";
import { toIssue } from "../../src/domain/issue.js";
import type { Finding } from "../../src/domain/result.js";

function issueFor(code: string, evidence: Finding["evidence"] = []) {
  return toIssue(
    {
      level: 2,
      severity: "warn",
      status: "warn",
      code,
      skill: "review",
      message: `Finding ${code}`,
      evidence,
      remediation: `Resolve ${code} using the documented remediation.`,
    },
    {},
  );
}

describe("ActionPlan", () => {
  it("rejects an empty issue list", () => {
    expect(() => createActionPlan({ rootPath: "/workspace", issues: [] })).toThrow(/issue/i);
  });

  it("includes safe patch changes and manual steps", () => {
    const scriptModeIssue = issueFor("structure.invalid-script-mode", [{ path: "scripts/check.sh", mode: "0777" }]);
    const missingDescriptionIssue = issueFor("structure.missing-description");
    const plan = createActionPlan({
      rootPath: "/workspace",
      issues: [scriptModeIssue, missingDescriptionIssue],
      generatedAt: "2026-08-05T10:00:00.000Z",
    });

    expect(plan.changes).toEqual([
      { path: "scripts/check.sh", before: "", after: "", safety: "safe", modeBefore: 0o777, modeAfter: 0o755 },
    ]);
    expect(plan.manualSteps).toEqual([
      {
        issueId: missingDescriptionIssue.id,
        title: "Manually resolve structure.missing-description",
        steps: [
          "Resolve structure.missing-description using the documented remediation.",
          "Verify that structure.missing-description no longer appears in the next SkillSync verification.",
        ],
      },
    ]);
  });

  it("sorts issue IDs and changes deterministically", () => {
    const later = issueFor("structure.invalid-script-mode", [{ path: "scripts/z.sh", mode: "0777" }]);
    const earlier = issueFor("structure.invalid-script-mode", [{ path: "scripts/a.sh", mode: "0777" }]);
    const plan = createActionPlan({
      rootPath: "/workspace",
      issues: [later, earlier],
      generatedAt: "2026-08-05T10:00:00.000Z",
    });

    expect(plan.issueIds).toEqual([...plan.issueIds].sort());
    expect(plan.changes.map((change) => change.path)).toEqual(["scripts/a.sh", "scripts/z.sh"]);
  });

  it("sorts otherwise-identical changes by safety before hashing", () => {
    const safeChange: PatchChange = {
      path: "scripts/check.sh",
      before: "",
      after: "",
      safety: "safe",
      modeBefore: 0o777,
      modeAfter: 0o755,
    };
    const reviewRequiredChange: PatchChange = { ...safeChange, safety: "review-required" };
    const firstOrder = sortPatchChanges([safeChange, reviewRequiredChange]);
    const secondOrder = sortPatchChanges([reviewRequiredChange, safeChange]);
    const firstPlan = {
      schema_version: 1 as const,
      rootPath: "/workspace",
      issueIds: ["iss_example"],
      changes: firstOrder,
      manualSteps: [],
    };
    const secondPlan = { ...firstPlan, changes: secondOrder };

    expect(firstOrder).toEqual([reviewRequiredChange, safeChange]);
    expect(secondOrder).toEqual(firstOrder);
    expect(planDigest(firstPlan)).toBe(planDigest(secondPlan));
  });

  it("keeps the digest stable when only generatedAt changes", () => {
    const issue = issueFor("structure.invalid-script-mode", [{ path: "scripts/check.sh", mode: "0777" }]);
    const first = createActionPlan({ rootPath: "/workspace", issues: [issue], generatedAt: "2026-08-05T10:00:00.000Z" });
    const second = createActionPlan({ rootPath: "/workspace", issues: [issue], generatedAt: "2026-08-05T11:00:00.000Z" });

    expect(first.planDigest).toBe(second.planDigest);
  });

  it("does not mutate input issues", () => {
    const issue = issueFor("structure.invalid-script-mode", [{ path: "scripts/check.sh", mode: "0777" }]);
    const before = structuredClone(issue);

    createActionPlan({ rootPath: "/workspace", issues: [issue], generatedAt: "2026-08-05T10:00:00.000Z" });

    expect(issue).toEqual(before);
  });
});
