import { describe, expect, it } from "vitest";

import { compareIssues, createBaseline } from "../../src/domain/baseline";
import { toIssue } from "../../src/domain/issue";
import type { Issue, IssueState } from "../../src/domain/issue";
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
    evidence: [{ path: "/private/root/skills/review/SKILL.md", content: `private source for ${code}` }],
  };

  return { ...toIssue(finding, { targetRoot: "/private/root/skills" }), state };
}

describe("Baseline", () => {
  it("sorts skills and issues without retaining Skill source content", () => {
    const first = issue("z-rule");
    const ignored = issue("a-rule", "ignored");
    const input = {
      rootDigest: "sha256:root",
      skills: [
        { name: "zebra", digest: "sha256:z" },
        { name: "alpha", digest: "sha256:a" },
      ],
      issues: [first, ignored],
      ignoredReasons: { [ignored.id]: "accepted for this baseline" },
      profileFingerprint: "sha256:profile",
      policyFingerprint: "sha256:policy",
    };
    const before = structuredClone(input);

    const baseline = createBaseline(input);

    expect(baseline.skills).toEqual([
      { name: "alpha", digest: "sha256:a" },
      { name: "zebra", digest: "sha256:z" },
    ]);
    expect(baseline.issues).toEqual([
      { id: ignored.id, state: "ignored", reason: "accepted for this baseline" },
      { id: first.id, state: "open" },
    ].sort((left, right) => left.id.localeCompare(right.id)));
    expect(JSON.stringify(baseline)).not.toContain("private source");
    expect(input).toEqual(before);
  });

  it("rejects ignored issues without a non-empty reason", () => {
    const ignored = issue("ignored-rule", "ignored");
    const input = {
      rootDigest: "sha256:root",
      skills: [],
      issues: [ignored],
      profileFingerprint: "sha256:profile",
      policyFingerprint: "sha256:policy",
    };

    expect(() => createBaseline(input)).toThrow(/reason/i);
    expect(() => createBaseline({ ...input, ignoredReasons: { [ignored.id]: "   " } })).toThrow(/reason/i);
  });

  it("classifies new, ongoing, resolved, regressed, and ignored-baseline issues by ID", () => {
    const ongoing = issue("ongoing");
    const resolved = issue("resolved");
    const newIssue = issue("new");
    const regressed = issue("regressed");
    const ignored = issue("ignored");
    const baseline = createBaseline({
      rootDigest: "sha256:root",
      skills: [],
      issues: [{ ...regressed, state: "resolved" }, { ...ignored, state: "ignored" }],
      ignoredReasons: { [ignored.id]: "kept visible on recurrence" },
      profileFingerprint: "sha256:profile",
      policyFingerprint: "sha256:policy",
    });

    const result = compareIssues([ongoing, resolved], [ongoing, newIssue, regressed, ignored], baseline);

    expect(result).toEqual({
      newIds: [newIssue.id, ignored.id].sort(),
      ongoingIds: [ongoing.id],
      resolvedIds: [resolved.id],
      regressedIds: [regressed.id],
    });
  });

  it("classifies duplicate IDs only once without mutating snapshots", () => {
    const ongoing = issue("ongoing");
    const newIssue = issue("new");
    const before = [ongoing, ongoing];
    const after = [newIssue, ongoing, newIssue, ongoing];
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);

    const comparison = compareIssues(before, after);

    expect(comparison).toEqual({
      newIds: [newIssue.id],
      ongoingIds: [ongoing.id],
      resolvedIds: [],
      regressedIds: [],
    });
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });
});
