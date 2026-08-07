import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planDigest } from "../../src/domain/action-plan";
import { runCli } from "../../src/cli/index";

async function createSkillRoot(): Promise<{ root: string; scriptPath: string }> {
  const parent = await mkdtemp(join(tmpdir(), "skillsync-fix-"));
  const root = join(parent, "review");
  const skillRoot = root;
  const scriptPath = join(skillRoot, "scripts", "check.sh");
  await mkdir(join(skillRoot, "scripts"), { recursive: true });
  await writeFile(join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review a change.\n---\n");
  await writeFile(scriptPath, "#!/bin/sh\necho safe\n", { mode: 0o777 });
  await chmod(scriptPath, 0o777);
  return { root, scriptPath };
}

async function issueIdFor(root: string, code: string): Promise<string> {
  const result = await runCli(["verify", "--path", root, "--target", "codex", "--format", "json"]);
  const issue = (JSON.parse(result.stdout) as {
    issues: Array<{ id: string; identity: { code: string } }>;
  }).issues.find((candidate) => candidate.identity.code === code);
  if (!issue) throw new Error(`Fixture did not produce ${code}`);
  return issue.id;
}

describe("skillsync fix", () => {
  it("plans enriched issues without changing the workspace and respects --issue", async () => {
    const { root, scriptPath } = await createSkillRoot();
    const issueId = await issueIdFor(root, "structure.invalid-script-mode");
    const beforeContent = await readFile(scriptPath, "utf8");
    const beforeMode = (await stat(scriptPath)).mode & 0o777;

    const allIssues = await runCli(["fix", "--plan", "--path", root]);
    expect(allIssues.exitCode).toBe(0);
    expect(allIssues.stdout).toContain("Patches:");
    expect(allIssues.stdout).toContain("scripts/check.sh (safe mode 777 -> 755)");
    expect(allIssues.stdout).toContain("Manual steps:");
    expect(allIssues.stdout).toContain("No Skill workspace files written by the plan operation.");

    const selected = await runCli([
      "fix",
      "--plan",
      "--path",
      root,
      "--target",
      "codex",
      "--issue",
      issueId,
      "--format",
      "json",
    ]);
    expect(selected.exitCode).toBe(0);
    const plan = JSON.parse(selected.stdout) as {
      issueIds: string[];
      changes: Array<{ path: string; safety: string }>;
      manualSteps: unknown[];
    };
    expect(plan.issueIds).toEqual([issueId]);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "scripts/check.sh", safety: "safe" }),
    ]));
    expect(plan.manualSteps).toEqual([]);
    await expect(readFile(scriptPath, "utf8")).resolves.toBe(beforeContent);
    await expect(stat(scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(beforeMode);
  });

  it("writes an explicit plan once and refuses to overwrite it", async () => {
    const { root } = await createSkillRoot();
    const issueId = await issueIdFor(root, "structure.invalid-script-mode");
    const outputPath = join(root, "fix-plan.json");
    const first = await runCli([
      "fix",
      "--plan",
      "--path",
      root,
      "--issue",
      issueId,
      "--output",
      outputPath,
    ]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("No Skill workspace files written by the plan operation.");
    expect(first.stdout).toContain(`Plan file written: ${outputPath}`);
    expect(JSON.parse(await readFile(outputPath, "utf8")).issueIds).toEqual([issueId]);

    const second = await runCli([
      "fix",
      "--plan",
      "--path",
      root,
      "--issue",
      issueId,
      "--output",
      outputPath,
    ]);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toMatch(/EEXIST|exist/i);
  });

  it("rejects multi-root plans before a plan can apply a matching path under the wrong root", async () => {
    const first = await createSkillRoot();
    const second = await createSkillRoot();
    const outputPath = join(first.root, "multi-root-plan.json");

    const planned = await runCli([
      "fix",
      "--plan",
      "--path",
      first.root,
      second.root,
      "--output",
      outputPath,
    ]);

    expect(planned.exitCode).toBe(1);
    expect(planned.stderr).toContain("multi-root ActionPlans are not supported");
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    await expect(stat(first.scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);
    await expect(stat(second.scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);
  });

  it("rejects a collection path before child issue patches can bind to collection files", async () => {
    const collection = await mkdtemp(join(tmpdir(), "skillsync-fix-collection-"));
    const first = await createSkillRootInCollection(collection, "first");
    const second = await createSkillRootInCollection(collection, "second");
    const decoyPath = join(collection, "scripts", "check.sh");
    const outputPath = join(collection, "collection-plan.json");
    await mkdir(join(collection, "scripts"), { recursive: true });
    await writeFile(decoyPath, "#!/bin/sh\necho decoy\n", { mode: 0o777 });
    await chmod(decoyPath, 0o777);

    const planned = await runCli([
      "fix",
      "--plan",
      "--path",
      collection,
      "--output",
      outputPath,
    ]);

    expect(planned.exitCode).toBe(1);
    expect(planned.stderr).toContain("Skill root containing a direct SKILL.md");
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    await expect(readFile(first.scriptPath, "utf8")).resolves.toBe("#!/bin/sh\necho safe\n");
    await expect(readFile(second.scriptPath, "utf8")).resolves.toBe("#!/bin/sh\necho safe\n");
    await expect(readFile(decoyPath, "utf8")).resolves.toBe("#!/bin/sh\necho decoy\n");
    await expect(stat(first.scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);
    await expect(stat(second.scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);
    await expect(stat(decoyPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);
  });

  it("requires --yes and applies a safe mode-only patch without changing its content", async () => {
    const { root, scriptPath } = await createSkillRoot();
    const issueId = await issueIdFor(root, "structure.invalid-script-mode");
    const planPath = join(root, "apply-plan.json");
    const planned = await runCli([
      "fix",
      "--plan",
      "--path",
      root,
      "--issue",
      issueId,
      "--output",
      planPath,
    ]);
    expect(planned.exitCode).toBe(0);
    const beforeContent = await readFile(scriptPath, "utf8");

    const withoutYes = await runCli(["fix", "--apply", "--plan", planPath]);
    expect(withoutYes.exitCode).toBe(1);
    expect(withoutYes.stderr).toContain("--yes");
    await expect(stat(scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);

    const applyWithTarget = await runCli([
      "fix",
      "--apply",
      "--plan",
      planPath,
      "--yes",
      "--target",
      "codex",
    ]);
    expect(applyWithTarget.exitCode).toBe(1);
    expect(applyWithTarget.stderr).toContain("fix --apply accepts only");
    await expect(stat(scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o777);

    const applied = await runCli(["fix", "--apply", "--plan", planPath, "--yes", "--format", "json"]);
    expect(applied.exitCode).toBe(0);
    const receipt = JSON.parse(applied.stdout) as {
      status: string;
      changedPaths: string[];
      appliedNotVerified: boolean;
      nextCommand: string;
    };
    expect(receipt.status).toBe("applied");
    expect(receipt.changedPaths).toEqual(["scripts/check.sh"]);
    expect(receipt.appliedNotVerified).toBe(true);
    expect(receipt.nextCommand).toBe("skillsync verify");
    await expect(readFile(scriptPath, "utf8")).resolves.toBe(beforeContent);
    await expect(stat(scriptPath).then((entry) => entry.mode & 0o777)).resolves.toBe(0o755);
  });

  it("requires review approval and rejects unsupported formats", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-fix-review-"));
    const skillPath = join(root, "SKILL.md");
    const planPath = join(root, "review-plan.json");
    await writeFile(skillPath, "before\n");
    const digestInput = {
      schema_version: 1 as const,
      rootPath: root,
      issueIds: ["iss_review"],
      changes: [{ path: "SKILL.md", before: "before\n", after: "after\n", safety: "review-required" as const }],
      manualSteps: [],
    };
    await writeFile(planPath, `${JSON.stringify({
      ...digestInput,
      generatedAt: "2026-08-05T10:00:00.000Z",
      planDigest: planDigest(digestInput),
    })}\n`);

    const unsupportedApply = await runCli(["fix", "--apply", "--plan", planPath, "--yes", "--format", "yaml"]);
    expect(unsupportedApply.exitCode).toBe(1);
    expect(unsupportedApply.stderr).toContain("Unsupported fix output format");
    await expect(readFile(skillPath, "utf8")).resolves.toBe("before\n");

    const rejected = await runCli(["fix", "--apply", "--plan", planPath, "--yes"]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("Review-required");
    await expect(readFile(skillPath, "utf8")).resolves.toBe("before\n");

    const approved = await runCli([
      "fix",
      "--apply",
      "--plan",
      planPath,
      "--yes",
      "--approve-review-required",
    ]);
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain("Applied is not verified. Next command: skillsync verify");
    await expect(readFile(skillPath, "utf8")).resolves.toBe("after\n");

    const unsupported = await runCli(["fix", "--plan", "--path", root, "--format", "yaml"]);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stderr).toContain("Unsupported fix output format");
  });
});

async function createSkillRootInCollection(
  collection: string,
  name: string,
): Promise<{ root: string; scriptPath: string }> {
  const root = join(collection, name);
  const scriptPath = join(root, "scripts", "check.sh");
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "SKILL.md"), `---\nname: ${name}\ndescription: Review a change.\n---\n`);
  await writeFile(scriptPath, "#!/bin/sh\necho safe\n", { mode: 0o777 });
  await chmod(scriptPath, 0o777);
  return { root, scriptPath };
}
