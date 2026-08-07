import { describe, expect, it } from "vitest";

import { toIssue } from "../../src/domain/issue";
import { buildResolutions } from "../../src/domain/resolution";
import type { Finding } from "../../src/domain/result";
import { renderText } from "../../src/reporters/text";
import type { VerificationReport } from "../../src/cli/commands/verify";

function issueFor(
  severity: Finding["severity"],
  code: string,
  overrides: Partial<Finding> = {},
) {
  const finding: Finding = {
    level: 2,
    severity,
    status: severity === "info" ? "pass" : severity === "warn" ? "warn" : "fail",
    code,
    skill: "review",
    target: "codex",
    message: `Cause for ${code}.`,
    evidence: [{ path: "references/guide.md", content: "credential=SUPER_SECRET" }],
    remediation: `Repair ${code}.`,
    ...overrides,
  };
  const issue = toIssue(finding, {});
  return { ...issue, resolutions: buildResolutions(issue, { rootPath: "/workspace/private-project" }) };
}

describe("renderText", () => {
  it("groups issues by severity and ID with bounded explanations and resolutions", () => {
    const critical = issueFor("critical", "provenance.critical");
    const safe = issueFor("error", "structure.invalid-script-mode", {
      evidence: [{ path: "scripts/check.sh", mode: "0777", content: "credential=SUPER_SECRET" }],
    });
    const manual = issueFor("warn", "structure.missing-reference");
    const anotherManual = issueFor("warn", "provenance.local-only");
    const info = issueFor("info", "provenance.verified");
    const report: VerificationReport = {
      schema_version: 1,
      generated_at: "2026-08-04T10:00:00.000Z",
      targets: [{ name: "project", path: "/workspace/private-project", scope: "explicit" }],
      findings: [manual.finding, safe.finding, critical.finding, info.finding, anotherManual.finding],
      issues: [manual, { ...info, location: { path: "C:\\private-project\\SKILL.md" } }, safe, critical, anotherManual],
      summary: { total: 5, pass: 1, warn: 2, fail: 2, unknown: 0 },
      exitCode: 1,
    };

    const text = renderText(report);

    expect(text.split("\n").slice(0, 2)).toEqual([
      "SkillSync verification: 5 findings",
      "pass=1 warn=2 fail=2 unknown=0",
    ]);
    expect(text.indexOf(critical.id)).toBeLessThan(text.indexOf(safe.id));
    expect(text.indexOf(safe.id)).toBeLessThan(text.indexOf(manual.id));
    expect(text.indexOf(manual.id)).toBeLessThan(text.indexOf(info.id));
    const [firstWarn, secondWarn] = [manual, anotherManual].sort((left, right) => left.id.localeCompare(right.id));
    expect(text.indexOf(firstWarn.id)).toBeLessThan(text.indexOf(secondWarn.id));
    expect(text).toContain(`issueId=${safe.id} status=open code=structure.invalid-script-mode Skill=review target=codex`);
    expect(text).toContain("cause: Cause for structure.invalid-script-mode.");
    expect(text).toContain("impact: Repair structure.invalid-script-mode.");
    expect(text).toContain("location: scripts/check.sh");
    expect(text).toContain("resolution: Remove group/world write permissions from scripts/check.sh (safe)");
    expect(text).toContain("resolution: Manually resolve structure.missing-reference (manual)");
    expect(text).toContain("- Repair structure.missing-reference.");
    expect(text).not.toContain("/workspace/private-project");
    expect(text).not.toContain("C:\\private-project\\SKILL.md");
    expect(text).not.toContain("credential=SUPER_SECRET");
  });

  it("renders legacy findings when issues are absent", () => {
    const report = {
      schema_version: 1 as const,
      generated_at: "2026-08-04T10:00:00.000Z",
      targets: [],
      findings: [
        {
          level: 1 as const,
          severity: "warn" as const,
          status: "warn" as const,
          code: "provenance.local-only",
          skill: "review",
          message: "Skill source is local-only.",
          evidence: [],
        },
      ],
      summary: { total: 1, pass: 0, warn: 1, fail: 0, unknown: 0 },
      exitCode: 0 as const,
    } as VerificationReport;

    expect(renderText(report)).toContain("WARN provenance.local-only review: Skill source is local-only.");
  });

  it("redacts absolute paths embedded in explanations and remediation", () => {
    const root = "/workspace/private-project";
    const issue = issueFor("error", "structure.missing-reference", {
      message: `Referenced resource at ${root}/references/missing.md does not exist.`,
      remediation: `Add the referenced file under ${root}.`,
      evidence: [{ path: `${root}/references/missing.md` }],
    });
    const report: VerificationReport = {
      schema_version: 1,
      generated_at: "2026-08-04T10:00:00.000Z",
      targets: [{ name: "project", path: root, scope: "explicit" }],
      findings: [issue.finding],
      issues: [issue],
      summary: { total: 1, pass: 0, warn: 0, fail: 1, unknown: 0 },
      exitCode: 1,
      reporting: { sarif: true, include_local_paths: false },
    };

    const text = renderText(report);

    expect(text).not.toContain(root);
    expect(text).toContain("<local-path>");
  });
});
