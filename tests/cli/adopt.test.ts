import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

describe("skillsync adopt", () => {
  it("creates a read-only adoption plan and requires explicit confirmation to apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-adopt-"));
    const skillRoot = join(root, "review");
    const outputPath = join(root, "managed", "skills.lock.json");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review a change.\n---\n",
    );

    const plan = await runCli([
      "adopt",
      "--path",
      root,
      "--plan",
      "--format",
      "json",
    ]);

    expect(plan.exitCode).toBe(0);
    const planReport = JSON.parse(plan.stdout) as {
      mode: string;
      actions: Array<{ type: string; name: string }>;
    };
    expect(planReport.mode).toBe("plan");
    expect(planReport.actions).toEqual([{ type: "record", name: "review" }]);
    await expect(access(outputPath)).rejects.toThrow();

    const withoutConfirmation = await runCli([
      "adopt",
      "--path",
      root,
      "--apply",
      "--output",
      outputPath,
      "--format",
      "json",
    ]);
    expect(withoutConfirmation.exitCode).toBe(1);
    expect(withoutConfirmation.stderr).toContain("--yes");

    const applied = await runCli([
      "adopt",
      "--path",
      root,
      "--apply",
      "--yes",
      "--output",
      outputPath,
      "--format",
      "json",
    ]);
    expect(applied.exitCode).toBe(0);
    const appliedReport = JSON.parse(applied.stdout) as {
      mode: string;
      outputPath: string;
    };
    expect(appliedReport.mode).toBe("applied");
    expect(appliedReport.outputPath).toBe(outputPath);
    expect(JSON.parse(await readFile(outputPath, "utf8")).skills.review).toBeDefined();

    const overwriteWithoutGuards = await runCli([
      "adopt",
      "--path",
      root,
      "--apply",
      "--yes",
      "--output",
      outputPath,
      "--format",
      "json",
    ]);
    expect(overwriteWithoutGuards.exitCode).toBe(1);
    expect(overwriteWithoutGuards.stderr).toContain("--force");

    const replaced = await runCli([
      "adopt",
      "--path",
      root,
      "--apply",
      "--yes",
      "--force",
      "--backup",
      "--output",
      outputPath,
      "--format",
      "json",
    ]);
    expect(replaced.exitCode).toBe(0);
    const replacedReport = JSON.parse(replaced.stdout) as { backupPath?: string };
    expect(replacedReport.backupPath).toBeDefined();
    await expect(access(replacedReport.backupPath ?? "")).resolves.toBeUndefined();
  });
});
