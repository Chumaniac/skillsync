import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanInventory } from "../../src/domain/inventory";
import { inspectStructure } from "../../src/scanners/structure";
import type { Skill } from "../../src/domain/skill";

describe("Skill path boundaries", () => {
  it("does not read a symlink target outside the Skill root", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-boundary-"));
    const outside = await mkdtemp(join(tmpdir(), "skillsync-outside-"));
    const skillRoot = join(root, "review");
    const outsideFile = join(outside, "secret.txt");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
    await writeFile(outsideFile, "do-not-read");
    await symlink(outsideFile, join(skillRoot, "references/outside.txt"));

    const inventory = await scanInventory(
      [{ name: "explicit", path: root, scope: "explicit" }],
      { followSymlinks: true },
    );
    const symlinkFile = inventory.skills[0]?.files.find((file) => file.relativePath === "references/outside.txt");

    expect(inventory.findings).toContainEqual(
      expect.objectContaining({ code: "inventory.symlink-outside-root", status: "warn" }),
    );
    expect(symlinkFile?.isSymlink).toBe(true);
    expect(symlinkFile?.content.toString()).toBe(outsideFile);
    expect(symlinkFile?.content.toString()).not.toContain(await readFile(outsideFile, "utf8"));
  });

  it("reports a relative reference that escapes the root", () => {
    const file = {
      relativePath: "SKILL.md",
      content: Buffer.from("---\nname: review\ndescription: Review\n---\n[bad](../outside.md)"),
      mode: 0o644,
      isSymlink: false,
    };
    const skill = {
      name: "review",
      rootPath: "/tmp/skills/review",
      skillMdPath: "/tmp/skills/review/SKILL.md",
      frontmatter: {},
      files: [file],
      source: { kind: "local" as const },
      digest: "sha256:" + "a".repeat(64),
    } satisfies Skill;

    expect(inspectStructure(skill)).toContainEqual(
      expect.objectContaining({ code: "structure.unsafe-path", status: "fail" }),
    );
  });
});
