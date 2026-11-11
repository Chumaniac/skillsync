import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanInventory, type ScanTarget } from "../../src/domain/inventory";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const target = (path: string): ScanTarget => ({ name: "fixture", path, scope: "explicit" });

async function skill(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillsync-capacity-"));
  roots.push(root);
  await writeFile(join(root, "SKILL.md"), "---\nname: fixture\ndescription: synthetic\n---\n");
  return root;
}

describe("bounded Skill inventory", () => {
  it("rejects a large file without returning partial skills", async () => {
    const root = await skill();
    await writeFile(join(root, "large.txt"), "x".repeat(129));
    await expect(scanInventory([target(root)], { limits: { maxFileBytes: 128 } }))
      .rejects.toMatchObject({ code: "inventory.capacity", exitCode: 2, bound: "maxFileBytes" });
  });

  it("shares the byte budget across separate targets", async () => {
    const first = await skill(), second = await skill();
    await expect(scanInventory([target(first), target(second)], { limits: { maxTotalBytes: 60 } }))
      .rejects.toMatchObject({ code: "inventory.capacity", bound: "maxTotalBytes" });
  });

  it("bounds file count and directory enumeration", async () => {
    const root = await skill();
    await writeFile(join(root, "one.txt"), "1");
    await expect(scanInventory([target(root)], { limits: { maxFiles: 1 } }))
      .rejects.toMatchObject({ bound: "maxFiles" });
    await mkdir(join(root, "empty"));
    await expect(scanInventory([target(root)], { limits: { maxEntries: 2 } }))
      .rejects.toMatchObject({ bound: "maxEntries" });
  });

  it("bounds recursive depth and target count", async () => {
    const root = await skill();
    await mkdir(join(root, "a/b"), { recursive: true });
    await expect(scanInventory([target(root)], { limits: { maxDepth: 1 } }))
      .rejects.toMatchObject({ bound: "maxDepth" });
    await expect(scanInventory([target(root), target(root)], { limits: { maxTargets: 1 } }))
      .rejects.toMatchObject({ bound: "maxTargets" });
  });

  it("counts followed file aliases against the same byte budget", async () => {
    const root = await skill();
    await writeFile(join(root, "data.txt"), "x".repeat(60));
    await symlink("data.txt", join(root, "alias.txt"));
    await expect(scanInventory([target(root)], { followSymlinks: true, limits: { maxTotalBytes: 120 } }))
      .rejects.toMatchObject({ bound: "maxTotalBytes" });
  });

  it("preserves complete small inventories and deterministic digests", async () => {
    const root = await skill();
    const before = await scanInventory([target(root)]);
    const limited = await scanInventory([target(root)], { limits: { maxFiles: 1, maxTotalBytes: 128, maxFileBytes: 128 } });
    expect(limited.skills[0]?.digest).toBe(before.skills[0]?.digest);
    expect(limited.skills[0]?.files).toHaveLength(1);
  });
});
