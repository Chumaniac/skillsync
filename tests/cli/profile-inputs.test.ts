import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skillsync-profiles-"));
  roots.push(root);
  const skill = join(root, "skill");
  await mkdir(skill);
  await writeFile(join(skill, "SKILL.md"), "---\nname: review\ndescription: Review a change\n---\n");
  return { root, skill };
}

describe("explicit profile inputs", () => {
  it.each(["verify", "compat"])("%s rejects an unknown target instead of skipping its checks", async (command) => {
    const { skill } = await fixture();
    const result = await runCli([command, "--path", skill, "--target", "nonexistent-platform"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("profile.unknown-target");
    expect(result.stdout).toBe("");
  });
  it.each(["missing", "malformed", "oversized"])("fails closed for an explicit %s profile directory", async (kind) => {
    const { root, skill } = await fixture();
    const dir = join(root, "profiles");
    if (kind !== "missing") {
      await mkdir(dir);
      await writeFile(join(dir, "custom.yaml"), kind === "oversized" ? "x".repeat(1024 * 1024 + 1) : "id: secret-sentinel\n");
    }
    const result = await runCli(["verify", "--path", skill, "--target", "codex", "--profile-dir", dir]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("profile.invalid-input");
    expect(result.stderr).not.toContain(root);
    expect(result.stderr).not.toContain("secret-sentinel");
  });
});
