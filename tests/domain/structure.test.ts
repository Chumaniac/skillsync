import { describe, expect, it } from "vitest";

import { computeSkillDigest } from "../../src/domain/digest";
import { inspectStructure } from "../../src/scanners/structure";
import type { Skill, SkillFile } from "../../src/domain/skill";

function makeSkill(options: {
  directoryName?: string;
  document?: string;
  extraFiles?: SkillFile[];
  name?: string;
} = {}): Skill {
  const directoryName = options.directoryName ?? "review";
  const files: SkillFile[] = [
    {
      relativePath: "SKILL.md",
      content: Buffer.from(options.document ?? "---\nname: review\ndescription: Review\n---\n"),
      mode: 0o644,
      isSymlink: false,
    },
    ...(options.extraFiles ?? []),
  ];

  return {
    name: options.name ?? directoryName,
    rootPath: `/tmp/skills/${directoryName}`,
    skillMdPath: `/tmp/skills/${directoryName}/SKILL.md`,
    frontmatter: {},
    files,
    source: { kind: "local" },
    digest: computeSkillDigest(files),
  };
}

function codes(skill: Skill): string[] {
  return inspectStructure(skill).map((finding) => finding.code);
}

describe("inspectStructure", () => {
  it("accepts valid frontmatter and an existing relative reference", () => {
    const skill = makeSkill({
      document:
        "---\nname: review\ndescription: Review\n---\nRead [the guide](references/guide.md).\n",
      extraFiles: [
        {
          relativePath: "references/guide.md",
          content: Buffer.from("Guide"),
          mode: 0o644,
          isSymlink: false,
        },
      ],
    });

    expect(inspectStructure(skill)).toEqual([]);
  });

  it("locates SKILL.md by normalized path rather than file order", () => {
    const skill = makeSkill({
      document:
        "---\nname: review\ndescription: Review\n---\nRead [the guide](references/guide.md).\n",
      extraFiles: [
        {
          relativePath: "references/guide.md",
          content: Buffer.from("Guide"),
          mode: 0o644,
          isSymlink: false,
        },
      ],
    });
    skill.files.reverse();

    expect(inspectStructure(skill)).toEqual([]);
  });

  it("reports missing SKILL.md and invalid frontmatter", () => {
    const missingSkillMd = makeSkill({ extraFiles: [], document: undefined });
    missingSkillMd.files = [];
    const invalidFrontmatter = makeSkill({ document: "---\nname: [review\n---\n" });

    expect(codes(missingSkillMd)).toContain("structure.missing-skill-md");
    expect(codes(invalidFrontmatter)).toContain("structure.invalid-frontmatter");
  });

  it("reports missing or non-string required metadata", () => {
    const missingDescription = makeSkill({ document: "---\nname: review\n---\n" });
    const nonStringName = makeSkill({ document: "---\nname: 42\ndescription: Review\n---\n" });

    expect(codes(missingDescription)).toContain("structure.missing-description");
    expect(codes(nonStringName)).toContain("structure.missing-name");
  });

  it("reports a directory/name mismatch and missing references", () => {
    const skill = makeSkill({
      directoryName: "review-folder",
      document:
        "---\nname: review\ndescription: Review\n---\nRead [missing](references/missing.md).\n",
    });

    expect(codes(skill)).toEqual(
      expect.arrayContaining(["structure.name-mismatch", "structure.missing-reference"]),
    );
  });

  it("reports unsafe paths and unsafe script modes without executing scripts", () => {
    const skill = makeSkill({
      document: "---\nname: review\ndescription: Review\n---\nRead [outside](../outside.md).\n",
      extraFiles: [
        {
          relativePath: "scripts/check.sh",
          content: Buffer.from("#!/bin/sh\necho should-not-run"),
          mode: 0o677,
          isSymlink: false,
        },
      ],
    });

    expect(codes(skill)).toEqual(
      expect.arrayContaining(["structure.unsafe-path", "structure.invalid-script-mode"]),
    );
  });
});
