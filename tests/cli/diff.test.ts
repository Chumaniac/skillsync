import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

async function createSkill(root: string, name: string, description: string): Promise<string> {
  const skillRoot = join(root, name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n`,
  );
  return skillRoot;
}

describe("skillsync diff", () => {
  it("reports semantic changes between explicit source and target Skill directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-diff-"));
    const before = await createSkill(join(root, "before"), "review", "Review a change.");
    const after = await createSkill(
      join(root, "after"),
      "review",
      "Review pull requests, security changes, and deployment plans.",
    );

    const result = await runCli([
      "diff",
      "--source",
      before,
      "--target",
      after,
      "--semantic",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      before: { name: string; digest: string };
      after: { name: string; digest: string };
      changes: Array<{ kind: string; summary: string }>;
      summary: { total: number };
    };
    expect(report.before.name).toBe("review");
    expect(report.after.name).toBe("review");
    expect(report.before.digest).not.toBe(report.after.digest);
    expect(report.changes.map((change) => change.kind)).toEqual(
      expect.arrayContaining(["routing-change", "provenance-change"]),
    );
    expect(report.summary.total).toBe(report.changes.length);
  });

  it("accepts before and after aliases and renders a readable summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-diff-alias-"));
    const before = await createSkill(join(root, "before"), "review", "Review a change.");
    const after = await createSkill(join(root, "after"), "review", "Review a change with policy.");

    const result = await runCli(["diff", "--before", before, "--after", after]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Semantic diff: review -> review");
    expect(result.stdout).toContain("routing-change");
    expect(result.stdout).toContain("provenance-change");
  });
});
