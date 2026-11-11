import { describe, expect, it } from "vitest";

import { SkillSchema, SkillSourceSchema } from "../../src/domain/skill";
import { FindingSchema } from "../../src/domain/result";

const digest = `sha256:${"a".repeat(64)}`;

function validSkill() {
  return {
    name: "review",
    rootPath: "/tmp/skills/review",
    skillMdPath: "/tmp/skills/review/SKILL.md",
    frontmatter: {
      name: "review",
      description: "Review a change",
    },
    files: [
      {
        relativePath: "SKILL.md",
        content: Buffer.from("---\nname: review\n---"),
        mode: 0o644,
        isSymlink: false,
      },
    ],
    source: {
      kind: "git" as const,
      url: "https://github.com/example/skills.git",
      ref: "main",
      resolvedCommit: "a".repeat(40),
    },
    digest,
  };
}

describe("Skill and Finding schemas", () => {
  it("accepts a normalized Skill and its source", () => {
    const skill = validSkill();

    expect(SkillSchema.safeParse(skill).success).toBe(true);
    expect(SkillSourceSchema.safeParse(skill.source).success).toBe(true);
  });

  it("accepts a finding with stable status and evidence fields", () => {
    const finding = {
      level: 2,
      severity: "warn",
      status: "unknown",
      code: "provenance.unknown-source",
      skill: "review",
      target: "codex.v1",
      message: "The source could not be resolved.",
      evidence: [{ field: "source", value: "local" }],
      remediation: "Record a source URL and resolved commit.",
    };

    expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("rejects unsupported source kinds and finding severities", () => {
    const invalidSkill = {
      ...validSkill(),
      source: { kind: "remote" },
    };
    const invalidFinding = {
      level: 2,
      severity: "fatal",
      status: "fail",
      code: "structure.invalid",
      skill: "review",
      message: "invalid",
      evidence: [],
    };

    expect(SkillSchema.safeParse(invalidSkill).success).toBe(false);
    expect(FindingSchema.safeParse(invalidFinding).success).toBe(false);
  });
});
