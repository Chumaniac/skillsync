import { describe, expect, it } from "vitest";

import { computeSkillDigest } from "../../src/domain/digest";
import { inspectProvenance } from "../../src/scanners/provenance";
import type { Skill, SkillSource } from "../../src/domain/skill";

function makeSkill(source: SkillSource = { kind: "local" }): Skill {
  const files = [
    {
      relativePath: "SKILL.md",
      content: Buffer.from("---\nname: review\ndescription: Review\n---\n"),
      mode: 0o644,
      isSymlink: false,
    },
  ];
  return {
    name: "review",
    rootPath: "/tmp/skills/review",
    skillMdPath: "/tmp/skills/review/SKILL.md",
    frontmatter: {},
    files,
    source,
    digest: computeSkillDigest(files),
  };
}

describe("inspectProvenance", () => {
  it("marks a local source as local-only", async () => {
    const findings = await inspectProvenance(makeSkill());

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "provenance.local-only",
        status: "warn",
      }),
    );
  });

  it("records a Git declaration without authenticating its remote identity", async () => {
    const findings = await inspectProvenance(
      makeSkill({
        kind: "git",
        url: "https://github.com/example/skills.git",
        ref: "v1",
        resolvedCommit: "a".repeat(40),
      }),
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "provenance.declared-source",
        status: "unknown",
      }),
    );
  });

  it("reports missing Git commit and content digest mismatches", async () => {
    const missingCommit = await inspectProvenance(
      makeSkill({ kind: "git", url: "https://github.com/example/skills.git", ref: "main" }),
    );
    const mismatched = makeSkill();
    mismatched.digest = `sha256:${"b".repeat(64)}`;
    const digestMismatch = await inspectProvenance(mismatched);

    expect(missingCommit).toContainEqual(
      expect.objectContaining({
        code: "provenance.missing-commit",
        status: "unknown",
      }),
    );
    expect(digestMismatch).toContainEqual(
      expect.objectContaining({
        code: "provenance.digest-mismatch",
        status: "fail",
      }),
    );
  });

  it("does not authenticate a declared Git identity from a plausible URL and commit", async () => {
    const findings = await inspectProvenance(makeSkill({
      kind: "git", url: "https://github.com/example/unrelated.git",
      resolvedCommit: "f".repeat(40),
    }));
    expect(findings.some(item => item.code === "provenance.verified")).toBe(false);
    expect(findings).toContainEqual(expect.objectContaining({
      code: "provenance.declared-source", status: "unknown", severity: "warn",
    }));
  });

  it("enforces an explicit root-path provenance policy", async () => {
    const findings = await inspectProvenance(makeSkill(), {
      allowedRootPrefixes: ["/approved-skills"],
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "provenance.path-not-allowed",
        status: "fail",
      }),
    );
  });
});
