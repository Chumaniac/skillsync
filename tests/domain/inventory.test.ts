import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  scanInventory,
  type ScanTarget,
} from "../../src/domain/inventory";

function target(name: string, path: string): ScanTarget {
  return { name, path, scope: "explicit" };
}

async function createSkill(parent: string, name: string, body = "description: review"): Promise<string> {
  const skillRoot = join(parent, name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\n${body}\n---\n\n# ${name}\n`,
  );
  return skillRoot;
}

describe("scanInventory", () => {
  it("reports a missing target without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-inventory-"));
    const result = await scanInventory([target("missing", join(root, "missing"))]);

    expect(result.skills).toHaveLength(0);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "inventory.missing-target",
        status: "warn",
        target: "missing",
      }),
    );
  });

  it("discovers Skill folders and records local-only source evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-inventory-"));
    await createSkill(root, "review");

    const result = await scanInventory([target("project-skills", root)]);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toEqual(
      expect.objectContaining({
        name: "review",
        source: { kind: "local" },
      }),
    );
    expect(result.skills[0]?.files.map((file) => file.relativePath)).toContain("SKILL.md");
    expect(result.targets).toEqual([target("project-skills", root)]);
  });

  it("emits identical and drift findings for duplicate logical names", async () => {
    const fixtureRoot = resolve("fixtures/provenance");
    const identicalPath = resolve(fixtureRoot, "duplicate-a/skills");
    const driftPath = resolve(fixtureRoot, "duplicate-b/skills");

    const identical = await scanInventory([
      target("first", identicalPath),
      target("second", identicalPath),
    ]);
    expect(identical.findings).toContainEqual(
      expect.objectContaining({ code: "inventory.duplicate-identical", skill: "review" }),
    );

    const drift = await scanInventory([
      target("first", identicalPath),
      target("second", driftPath),
    ]);
    expect(drift.findings).toContainEqual(
      expect.objectContaining({ code: "inventory.duplicate-drift", skill: "review" }),
    );
  });

  it("records broken symlinks without following them", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-inventory-"));
    const skillRoot = await createSkill(root, "review");
    await mkdir(join(skillRoot, "references"));
    await symlink("missing.md", join(skillRoot, "references/broken.md"));

    const result = await scanInventory([target("project-skills", root)]);

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "inventory.broken-symlink",
        skill: "review",
        status: "warn",
      }),
    );
    expect(result.skills[0]?.files).toContainEqual(
      expect.objectContaining({
        relativePath: "references/broken.md",
        isSymlink: true,
      }),
    );
  });
});
