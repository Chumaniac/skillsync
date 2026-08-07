import { chmod, lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { planDigest } from "../../src/domain/action-plan.js";
import type { ActionPlan } from "../../src/domain/action-plan.js";
import type { PatchChange } from "../../src/domain/resolution.js";
import { applyActionPlan } from "../../src/domain/patch-application.js";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true })));
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "skillsync-patch-"));
  workspaces.push(path);
  return path;
}

async function put(rootPath: string, relativePath: string, content: string, mode = 0o644): Promise<void> {
  const targetPath = join(rootPath, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, { encoding: "utf8", mode });
  await chmod(targetPath, mode);
}

function change(overrides: Partial<PatchChange> = {}): PatchChange {
  return {
    path: "SKILL.md",
    before: "before\n",
    after: "after\n",
    safety: "safe",
    ...overrides,
  };
}

function planFor(rootPath: string, changes: PatchChange[]): ActionPlan {
  const digestInput = {
    schema_version: 1 as const,
    rootPath,
    issueIds: ["iss_patch"],
    changes,
    manualSteps: [],
  };
  return {
    ...digestInput,
    generatedAt: "2026-08-05T10:00:00.000Z",
    planDigest: planDigest(digestInput),
  };
}

describe("applyActionPlan", () => {
  it("requires --yes without changing target content", async () => {
    const rootPath = await workspace();
    await put(rootPath, "SKILL.md", "before\n");

    await expect(applyActionPlan(planFor(rootPath, [change()]), { yes: false })).rejects.toThrow(/--yes/i);

    await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("before\n");
  });

  it("rejects stale content and stale mode before changing any target", async () => {
    const rootPath = await workspace();
    await put(rootPath, "content.md", "current\n");
    await put(rootPath, "mode.sh", "unchanged\n", 0o755);
    const contentPlan = planFor(rootPath, [change({ path: "content.md", before: "stale\n" })]);
    const modePlan = planFor(rootPath, [change({ path: "mode.sh", before: "", after: "", modeBefore: 0o777, modeAfter: 0o755 })]);

    await expect(applyActionPlan(contentPlan, { yes: true })).rejects.toThrow(/content/i);
    await expect(applyActionPlan(modePlan, { yes: true })).rejects.toThrow(/mode/i);

    await expect(readFile(join(rootPath, "content.md"), "utf8")).resolves.toBe("current\n");
    await expect(stat(join(rootPath, "mode.sh")).then((item) => item.mode & 0o777)).resolves.toBe(0o755);
  });

  it("applies a safe content patch and retains a backup receipt", async () => {
    const rootPath = await workspace();
    await put(rootPath, "SKILL.md", "before\n");
    const plan = planFor(rootPath, [change()]);

    const receipt = await applyActionPlan(plan, { yes: true, backup: true });

    expect(receipt).toMatchObject({
      schema_version: 1,
      status: "applied",
      planDigest: plan.planDigest,
      changedPaths: ["SKILL.md"],
    });
    expect(receipt.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(receipt.backupPath).toEqual(expect.any(String));
    await expect(lstat(receipt.backupPath!)).resolves.toBeDefined();
    await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("after\n");
  });

  it("applies a mode-only security patch while preserving content", async () => {
    const rootPath = await workspace();
    await put(rootPath, "scripts/check.sh", "echo safe\n", 0o777);
    const plan = planFor(rootPath, [change({ path: "scripts/check.sh", before: "", after: "", modeBefore: 0o777, modeAfter: 0o755 })]);

    const receipt = await applyActionPlan(plan, { yes: true, backup: false });

    expect(receipt.status).toBe("applied");
    await expect(readFile(join(rootPath, "scripts/check.sh"), "utf8")).resolves.toBe("echo safe\n");
    await expect(stat(join(rootPath, "scripts/check.sh")).then((item) => item.mode & 0o777)).resolves.toBe(0o755);
  });

  it("requires explicit approval for review-required patches", async () => {
    const rootPath = await workspace();
    await put(rootPath, "SKILL.md", "before\n");
    const plan = planFor(rootPath, [change({ safety: "review-required" })]);

    await expect(applyActionPlan(plan, { yes: true })).rejects.toThrow(/review/i);
    await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("before\n");

    await expect(applyActionPlan(plan, { yes: true, approveReviewRequired: true })).resolves.toMatchObject({ status: "applied" });
    await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("after\n");
  });

  it("rejects unsafe and non-regular targets before writes", async () => {
    const rootPath = await workspace();
    await put(rootPath, "SKILL.md", "before\n");
    await put(rootPath, "target.md", "before\n");
    await mkdir(join(rootPath, "directory"));
    await symlink(join(rootPath, "target.md"), join(rootPath, "link.md"));

    const invalidPaths = ["/tmp/outside", "C:\\outside", "nested/../escape.md", "", "directory", "link.md", "missing.md"];
    for (const path of invalidPaths) {
      await expect(applyActionPlan(planFor(rootPath, [change({ path })]), { yes: true })).rejects.toThrow();
      await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("before\n");
    }

    await expect(
      applyActionPlan(planFor(rootPath, [change(), change({ path: "SKILL.md" })]), { yes: true }),
    ).rejects.toThrow(/duplicate/i);
  });

  it("rejects a target below a symlinked parent directory before writing outside the root", async () => {
    const rootPath = await workspace();
    const outsidePath = await workspace();
    await put(rootPath, "SKILL.md", "before\n");
    await put(outsidePath, "escaped.md", "outside before\n");
    await symlink(outsidePath, join(rootPath, "linked-parent"), "dir");
    const plan = planFor(rootPath, [change({ path: "linked-parent/escaped.md", before: "outside before\n", after: "outside after\n" })]);

    await expect(applyActionPlan(plan, { yes: true })).rejects.toThrow(/symlink/i);
    await expect(readFile(join(outsidePath, "escaped.md"), "utf8")).resolves.toBe("outside before\n");
  });

  it("restores already changed targets when a later write fails", async () => {
    const rootPath = await workspace();
    await put(rootPath, "first.sh", "first unchanged\n", 0o777);
    await put(rootPath, "locked/second.md", "second before\n");
    await chmod(join(rootPath, "locked"), 0o555);
    const plan = planFor(rootPath, [
      change({ path: "first.sh", before: "", after: "", modeBefore: 0o777, modeAfter: 0o755 }),
      change({ path: "locked/second.md", before: "second before\n", after: "second after\n" }),
    ]);

    try {
      await expect(applyActionPlan(plan, { yes: true, backup: false })).rejects.toMatchObject({
        receipt: { status: "restored", changedPaths: ["first.sh"] },
      });
    } finally {
      await chmod(join(rootPath, "locked"), 0o755);
    }

    await expect(readFile(join(rootPath, "first.sh"), "utf8")).resolves.toBe("first unchanged\n");
    await expect(stat(join(rootPath, "first.sh")).then((item) => item.mode & 0o777)).resolves.toBe(0o777);
    await expect(readFile(join(rootPath, "locked/second.md"), "utf8")).resolves.toBe("second before\n");
  });

  it("rejects no-op changes", async () => {
    const rootPath = await workspace();
    await put(rootPath, "SKILL.md", "same\n");
    const plan = planFor(rootPath, [change({ before: "same\n", after: "same\n" })]);

    await expect(applyActionPlan(plan, { yes: true })).rejects.toThrow(/no-op/i);
    await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("same\n");
  });

  it("rejects tampered plans and unsafe mode requests before writes", async () => {
    const rootPath = await workspace();
    await put(rootPath, "SKILL.md", "before\n", 0o755);
    const staleDigest = { ...planFor(rootPath, [change()]), planDigest: "sha256:tampered" };
    const invalidMode = planFor(rootPath, [change({ before: "", after: "", modeBefore: 0o755, modeAfter: 0o1000 })]);
    const escalatingMode = planFor(rootPath, [change({ before: "", after: "", modeBefore: 0o755, modeAfter: 0o777 })]);

    await expect(applyActionPlan(staleDigest, { yes: true })).rejects.toThrow(/digest/i);
    await expect(applyActionPlan(invalidMode, { yes: true })).rejects.toThrow(/mode/i);
    await expect(applyActionPlan(escalatingMode, { yes: true })).rejects.toThrow(/mode/i);
    await expect(readFile(join(rootPath, "SKILL.md"), "utf8")).resolves.toBe("before\n");
  });

  it("never executes target workspace content", async () => {
    const rootPath = await workspace();
    const markerPath = join(rootPath, "executed.marker");
    await put(rootPath, "scripts/unsafe.sh", `#!/bin/sh\nprintf executed > ${markerPath}\n`);
    const plan = planFor(rootPath, [change({ path: "scripts/unsafe.sh", before: `#!/bin/sh\nprintf executed > ${markerPath}\n`, after: "#!/bin/sh\necho patched\n" })]);

    await expect(applyActionPlan(plan, { yes: true })).resolves.toMatchObject({ status: "applied" });
    await expect(lstat(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
