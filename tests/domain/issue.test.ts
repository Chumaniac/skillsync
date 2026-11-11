import { describe, expect, it } from "vitest";

import {
  issueIdForFinding,
  toIssue,
  toIssues,
  transitionIssueState,
} from "../../src/domain/issue";
import type { Finding } from "../../src/domain/result";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    level: 1,
    severity: "warn",
    status: "warn",
    code: "structure.missing-reference",
    skill: "review",
    target: "codex",
    message: "Reference is missing",
    evidence: [{ path: "references\\guide.md", line: "12" }, { field: "name", value: "review" }],
    remediation: "Add the referenced file",
    ...overrides,
  };
}

describe("Issue identity and lifecycle", () => {
  it("keeps the same ID when evidence records and keys are reordered", () => {
    const first = makeFinding();
    const reordered = makeFinding({
      evidence: [
        { value: "review", field: "name" },
        { line: "12", path: "references/guide.md" },
      ],
    });

    const id = issueIdForFinding(first);

    expect(id).toBe(issueIdForFinding(reordered));
    expect(id).toMatch(/^iss_[0-9a-f]{64}$/);
  });

  it("does not include message or remediation in the ID", () => {
    const changed = makeFinding({
      message: "A completely different explanation",
      remediation: "Use another repair process",
    });

    expect(issueIdForFinding(changed)).toBe(issueIdForFinding(makeFinding()));
  });

  it("orders evidence records by deterministic code-unit JSON order", () => {
    const issue = toIssue(
      makeFinding({ evidence: [{ value: "a" }, { value: "Z" }] }),
      {},
    );

    expect(issue.identity.evidenceKey).toBe('[{"value":"Z"},{"value":"a"}]');
  });

  it("creates an open Issue with deterministic explanation and no resolutions", () => {
    const issue = toIssue(makeFinding(), {});

    expect(issue.state).toBe("open");
    expect(issue.explanation).toEqual({
      cause: "Reference is missing",
      impact: "Add the referenced file",
      confidence: "deterministic",
    });
    expect(issue.resolutions).toEqual([]);
  });

  it("allows legal lifecycle transitions and rejects illegal ones", () => {
    const issue = toIssue(makeFinding(), {});

    const acknowledged = transitionIssueState(issue, "acknowledged");
    const resolved = transitionIssueState(acknowledged, "resolved");

    expect(acknowledged.state).toBe("acknowledged");
    expect(resolved.state).toBe("resolved");
    expect(() => transitionIssueState(issue, "regressed")).toThrow(/state/);
    expect(() => transitionIssueState(resolved, "open")).toThrow(/state/);
  });

  it("replaces absolute target roots with relative evidence paths", () => {
    const finding = makeFinding({
      evidence: [{ path: "/workspace/skills/references/guide.md" }],
    });
    const issue = toIssue(finding, { targetRoot: "/workspace/skills" });

    expect(issue.identity.evidenceKey).not.toContain("/workspace/skills");
    expect(issue.identity.evidenceKey).toContain("references/guide.md");
    expect(issue.location).toEqual({ path: "references/guide.md" });
  });

  it("treats filesystem root as a valid target root", () => {
    const finding = makeFinding({ evidence: [{ path: "/tmp/skills/SKILL.md" }] });
    const issue = toIssue(finding, { targetRoot: "/" });

    expect(issue.identity.evidenceKey).toContain("tmp/skills/SKILL.md");
    expect(issue.identity.evidenceKey).not.toContain("/tmp/skills/SKILL.md");
    expect(issue.location).toEqual({ path: "tmp/skills/SKILL.md" });
  });

  it("normalizes separators only in path-like evidence fields", () => {
    const issue = toIssue(
      makeFinding({ evidence: [{ path: "references\\guide.md", source_url: "https:\\example.com\\guide" }] }),
      {},
    );

    expect(issue.identity.evidenceKey).toContain('"path":"references/guide.md"');
    expect(issue.identity.evidenceKey).toContain(`"source_url":${JSON.stringify("https:\\example.com\\guide")}`);
  });

  it("maps findings without executing files or changing the inputs", () => {
    const findings = [makeFinding(), makeFinding({ code: "provenance.unknown-source" })];
    const before = structuredClone(findings);

    const issues = toIssues(findings, { targetRoots: new Map([["codex", "/workspace/skills"]]) });

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.state === "open")).toBe(true);
    expect(findings).toEqual(before);
  });
});
