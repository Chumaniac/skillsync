import { describe, expect, it } from "vitest";

import { buildResolutions } from "../../src/domain/resolution.js";
import { toIssue } from "../../src/domain/issue.js";
import type { Finding } from "../../src/domain/result.js";
import type { Skill } from "../../src/domain/skill.js";

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

describe("Resolution catalog", () => {
  it("offers a safe mode patch for a group/world writable script", () => {
    const resolutions = buildResolutions(
      issueFor("structure.invalid-script-mode", [{ path: "scripts/check.sh", mode: "0777" }]),
      { rootPath: "/workspace/review" },
    );

    expect(resolutions).toEqual([
      {
        kind: "patch",
        title: "Remove group/world write permissions from scripts/check.sh",
        safety: "safe",
        changes: [
          {
            path: "scripts/check.sh",
            before: "",
            after: "",
            safety: "safe",
            modeBefore: 0o777,
            modeAfter: 0o755,
          },
        ],
      },
      {
        kind: "ignore",
        title: "Ignore structure.invalid-script-mode",
        reasonRequired: true,
      },
    ]);
  });

  it("falls back to a manual resolution when script mode evidence is invalid or missing", () => {
    for (const evidence of [[], [{ path: "scripts/check.sh", mode: "rwxrwxrwx" }]]) {
      const resolutions = buildResolutions(
        issueFor("structure.invalid-script-mode", evidence),
        { rootPath: "/workspace/review" },
      );

      expect(resolutions[0]).toMatchObject({ kind: "manual", safety: "review-required" });
    }
  });

  it("never invents a description or missing referenced file", () => {
    for (const code of ["structure.missing-description", "structure.missing-reference"]) {
      const resolutions = buildResolutions(issueFor(code), { rootPath: "/workspace/review" });

      expect(resolutions[0]).toEqual({
        kind: "manual",
        title: `Manually resolve ${code}`,
        safety: "review-required",
        steps: [
          `Resolve ${code} using the documented remediation.`,
          `Verify that ${code} no longer appears in the next SkillSync verification.`,
        ],
      });
    }
  });

  it("requires a reason before an issue can be ignored", () => {
    const resolutions = buildResolutions(
      issueFor("structure.missing-description"),
      { rootPath: "/workspace/review" },
    );

    expect(resolutions.at(-1)).toEqual({
      kind: "ignore",
      title: "Ignore structure.missing-description",
      reasonRequired: true,
    });
  });

  it("offers a bounded safe patch for parseable frontmatter with unchanged values", () => {
    const content = Buffer.from("---\nname: review\ndescription: Review changes\n---\nBody\n");
    const skill: Skill = {
      name: "review",
      rootPath: "/workspace/review",
      skillMdPath: "/workspace/review/SKILL.md",
      frontmatter: { name: "review", description: "Review changes" },
      files: [{ relativePath: "SKILL.md", content, mode: 0o644, isSymlink: false }],
      source: { kind: "local" },
      digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };

    const resolutions = buildResolutions(
      issueFor("structure.frontmatter-format"),
      { rootPath: "/workspace/review", skill },
    );

    expect(resolutions[0]).toEqual({
      kind: "patch",
      title: "Normalize SKILL.md frontmatter formatting",
      safety: "safe",
      changes: [{
        path: "SKILL.md",
        before: "---\nname: review\ndescription: Review changes\n---\n",
        after: "---\ndescription: Review changes\nname: review\n---\n",
        safety: "safe",
      }],
    });
  });

  it("rejects unsafe patch paths", () => {
    const issue = issueFor("structure.invalid-script-mode", [{ path: "scripts/../check.sh", mode: "0777" }]);

    expect(() => buildResolutions(issue, { rootPath: "/workspace/review" })).toThrow(/path/i);
  });
});
