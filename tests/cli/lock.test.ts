import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

describe("skillsync lock", () => {
  it("generates, reads, and checks a normalized lock without writing the Skill", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-lock-"));
    const skillRoot = join(root, "review");
    const lockPath = join(root, "skills.lock.json");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review a change.\n---\n",
    );

    const generated = await runCli(["lock", "--path", root, "--format", "json"]);

    expect(generated.exitCode).toBe(0);
    const lock = JSON.parse(generated.stdout) as {
      schema_version: number;
      skills: Record<string, { content_digest: string; source: { kind: string } }>;
    };
    expect(lock.schema_version).toBe(1);
    expect(lock.skills.review.source.kind).toBe("local");
    expect(lock.skills.review.content_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    await writeFile(lockPath, JSON.stringify(lock, null, 2));

    const read = await runCli(["lock", "--from", lockPath, "--format", "json"]);
    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout)).toEqual(lock);

    const checked = await runCli([
      "lock",
      "--check",
      "--from",
      lockPath,
      "--path",
      root,
      "--format",
      "json",
    ]);
    expect(checked.exitCode).toBe(0);
    const checkReport = JSON.parse(checked.stdout) as {
      check: { summary: { pass: number; fail: number } };
    };
    expect(checkReport.check.summary).toEqual({ pass: 1, fail: 0 });

    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: A materially different review.\n---\n",
    );
    const drifted = await runCli([
      "lock",
      "--check",
      "--from",
      lockPath,
      "--path",
      root,
      "--format",
      "json",
    ]);
    expect(drifted.exitCode).toBe(1);
    const driftReport = JSON.parse(drifted.stdout) as {
      check: { summary: { pass: number; fail: number }; skills: Array<{ status: string }> };
    };
    expect(driftReport.check.summary).toEqual({ pass: 0, fail: 1 });
    expect(driftReport.check.skills[0]?.status).toBe("fail");
  });

  it("imports an npx skills v3 lock and fails closed when no SkillSync content digest exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-lock-v3-"));
    const skillRoot = join(root, "review");
    const lockPath = join(root, ".skill-lock.json");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review.\n---\n");
    await writeFile(lockPath, JSON.stringify({
      version: 3,
      skills: {
        review: {
          source: "vercel-labs/agent-skills",
          sourceType: "github",
          sourceUrl: "https://github.com/vercel-labs/agent-skills",
          ref: "main",
          skillPath: "skills/review",
          skillFolderHash: "a".repeat(40),
          installedAt: "2026-08-05T10:00:00.000Z",
          updatedAt: "2026-08-06T10:00:00.000Z",
        },
      },
    }, null, 2));

    const loaded = await runCli(["lock", "--from", lockPath, "--format", "json"]);

    expect(loaded.exitCode).toBe(0);
    expect(JSON.parse(loaded.stdout)).toMatchObject({
      schema_version: 1,
      metadata: { external: { version: 3 } },
    });

    const checked = await runCli([
      "lock",
      "--check",
      "--from",
      lockPath,
      "--path",
      root,
      "--format",
      "json",
    ]);

    expect(checked.exitCode).toBe(1);
    expect(JSON.parse(checked.stdout)).toMatchObject({
      check: {
        summary: { pass: 0, fail: 1 },
        skills: [
          expect.objectContaining({
            status: "fail",
            message: expect.stringContaining("content digest"),
          }),
        ],
      },
    });
  });
});
