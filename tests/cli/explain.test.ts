import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

describe("skillsync explain", () => {
  it("returns stable Issue details without writing or executing Skill content", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-explain-"));
    const skillRoot = join(root, "review");
    const marker = join(root, "executed.marker");
    const skillPath = join(skillRoot, "SKILL.md");
    const scriptPath = join(skillRoot, "scripts", "check.sh");
    await mkdir(join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      skillPath,
      `---\nname: review\ndescription: Review a change.\n---\n[Missing](references/missing.md)\n`,
    );
    await writeFile(scriptPath, `#!/bin/sh\nprintf executed > ${marker}\n`, { mode: 0o777 });
    const beforeSkill = await readFile(skillPath, "utf8");
    const beforeScript = await readFile(scriptPath, "utf8");

    const verification = await runCli([
      "verify",
      "--path",
      root,
      "--target",
      "codex",
      "--format",
      "json",
    ]);
    const issue = (JSON.parse(verification.stdout) as {
      issues: Array<{ id: string; identity: { code: string } }>;
    }).issues.find((candidate) => candidate.identity.code === "structure.missing-reference");
    expect(issue).toBeDefined();

    const result = await runCli([
      "explain",
      issue!.id,
      "--path",
      root,
      "--target",
      "codex",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Issue: ${issue!.id}`);
    expect(result.stdout).toContain("State: open");
    expect(result.stdout).toContain("Code: structure.missing-reference");
    expect(result.stdout).toContain("Skill/target: review");
    expect(result.stdout).toContain("Cause:");
    expect(result.stdout).toContain("Impact:");
    expect(result.stdout).toContain("Location: references/missing.md");
    expect(result.stdout).toContain("First resolution:");
    expect(result.stdout).toContain("Manual steps:");
    await expect(readFile(skillPath, "utf8")).resolves.toBe(beforeSkill);
    await expect(readFile(scriptPath, "utf8")).resolves.toBe(beforeScript);
    await expect(access(marker)).rejects.toThrow();
  });

  it("reports missing IDs with exit code 2 and rejects unsupported formats", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-explain-missing-"));
    const skillRoot = join(root, "review");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review a change.\n---\n");

    const missing = await runCli(["explain", "iss_missing", "--path", root]);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("issue.not-found");

    const verification = await runCli(["verify", "--path", root, "--format", "json"]);
    const issueId = (JSON.parse(verification.stdout) as { issues: Array<{ id: string }> }).issues[0]?.id;
    expect(issueId).toBeDefined();
    const unsupported = await runCli(["explain", issueId!, "--path", root, "--format", "yaml"]);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stderr).toContain("Unsupported explain output format");
  });
});
