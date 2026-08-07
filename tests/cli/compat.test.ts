import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

describe("skillsync compat", () => {
  it("accepts comma-separated targets and emits target-scoped JSON findings", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-compat-"));
    const skillRoot = join(root, "review");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review a change\n---\n",
    );

    const result = await runCli([
      "compat",
      "--path",
      root,
      "--target",
      "codex,claude-code",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      targets: Array<{ id: string }>;
      findings: Array<{ target?: string }>;
    };
    expect(report.targets.map((target) => target.id)).toEqual(["codex", "claude-code"]);
    expect(report.findings.some((finding) => finding.target === "codex")).toBe(true);
    expect(report.findings.some((finding) => finding.target === "claude-code")).toBe(true);
    expect(result.stdout).not.toContain(root);
    expect(report).toHaveProperty("skills.0.rootPath", "<local-path>");
  });
});
