import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

it("verify emits JUnit while keeping its original policy exit and never executing source scripts", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillsync-junit-")), marker = join(root, "executed.marker");
  await writeFile(join(root, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n[missing](absent.md)\n");
  await writeFile(join(root, "check.sh"), `touch ${marker}\n`);
  const original = await runCli(["verify", "--path", root, "--target", "codex", "--format", "json"]);
  const junit = await runCli(["verify", "--path", root, "--target", "codex", "--format", "junit"]);
  expect(junit.exitCode).toBe(original.exitCode);
  expect(junit.stdout).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
  expect(junit.stdout).toContain("structure.missing-reference");
  expect(junit.stdout).not.toContain(root);
  await expect(access(marker)).rejects.toThrow();
  const scan = await runCli(["scan", "--path", root, "--format", "junit"]);
  expect(scan.exitCode).toBe(0);
  expect(scan.stdout).toContain('name="SkillSync scan"');
  expect(scan.stdout).not.toContain(root);
});
