import { describe, expect, it } from "vitest";

import { computeSkillDigest } from "../../src/domain/digest";
import {
  compareSkills,
  type SemanticChange,
} from "../../src/domain/semantic-diff";
import type { Skill, SkillFile, SkillSource } from "../../src/domain/skill";

function makeSkill(
  frontmatter: Record<string, unknown>,
  extraFiles: SkillFile[] = [],
  source: SkillSource = { kind: "local" },
): Skill {
  const document = Buffer.from("---\nname: review\ndescription: Review\n---\n");
  const files: SkillFile[] = [
    {
      relativePath: "SKILL.md",
      content: document,
      mode: 0o644,
      isSymlink: false,
    },
    ...extraFiles,
  ];
  return {
    name: "review",
    rootPath: "/tmp/skills/review",
    skillMdPath: "/tmp/skills/review/SKILL.md",
    frontmatter,
    files,
    source,
    digest: computeSkillDigest(files),
  };
}

function kinds(changes: SemanticChange[]): string[] {
  return changes.map((change) => change.kind);
}

describe("compareSkills", () => {
  it("classifies description changes as routing changes", () => {
    const before = makeSkill({ name: "review", description: "Review pull requests." });
    const after = makeSkill({
      name: "review",
      description: "Review pull requests, security changes, and deployment plans.",
    });

    expect(kinds(compareSkills(before, after))).toContain("routing-change");
  });

  it("classifies allowed-tools changes as capability changes", () => {
    const before = makeSkill({ name: "review", description: "Review", "allowed-tools": ["Read"] });
    const after = makeSkill({
      name: "review",
      description: "Review",
      "allowed-tools": ["Read", "Bash"],
    });

    expect(kinds(compareSkills(before, after))).toContain("capability-change");
  });

  it("classifies script additions as capability changes", () => {
    const before = makeSkill({ name: "review", description: "Review" });
    const after = makeSkill(
      { name: "review", description: "Review" },
      [
        {
          relativePath: "scripts/check.sh",
          content: Buffer.from("#!/bin/sh\n"),
          mode: 0o755,
          isSymlink: false,
        },
      ],
    );

    expect(kinds(compareSkills(before, after))).toContain("capability-change");
  });

  it("classifies deleted references as resource changes", () => {
    const reference = {
      relativePath: "references/guide.md",
      content: Buffer.from("Guide"),
      mode: 0o644,
      isSymlink: false,
    };
    const before = makeSkill({ name: "review", description: "Review" }, [reference]);
    const after = makeSkill({ name: "review", description: "Review" });

    expect(kinds(compareSkills(before, after))).toContain("resource-change");
  });

  it("classifies resolved commit changes as provenance changes", () => {
    const before = makeSkill(
      { name: "review", description: "Review" },
      [],
      { kind: "git", url: "https://github.com/example/skills.git", ref: "main", resolvedCommit: "a".repeat(40) },
    );
    const after = makeSkill(
      { name: "review", description: "Review" },
      [],
      { kind: "git", url: "https://github.com/example/skills.git", ref: "main", resolvedCommit: "b".repeat(40) },
    );

    expect(kinds(compareSkills(before, after))).toContain("provenance-change");
  });

  it("classifies a target compatibility regression explicitly", () => {
    const before = makeSkill({
      name: "review",
      description: "Review",
      compatibility: { codex: "pass" },
    });
    const after = makeSkill({
      name: "review",
      description: "Review",
      compatibility: { codex: "fail" },
    });

    expect(kinds(compareSkills(before, after))).toContain("compatibility-loss");
  });
});
