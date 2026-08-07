import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { BehaviorFixtureV2 } from "../../src/domain/behavior-fixture";
import { stageBehaviorFixture } from "../../src/sandbox/staging";

const manifest = {
  schema_version: 2,
  id: "replay-basic",
  description: "A staging fixture.",
  skill_path: "skill",
  agent: "codex",
  execution: {
    backend: "replay",
    replay_trace: "events.jsonl",
    timeout_ms: 30_000,
    memory_mb: 512,
    cpu_limit: 1,
    pids_limit: 64,
    network: { mode: "deny", allowed_hosts: [] },
    environment: { allow: [] },
  },
  invariants: {
    allowed_writes: ["workspace/review.md"],
    required_outputs: ["workspace/review.md"],
    forbidden_paths: ["/Users/**"],
    allowed_tools: [],
  },
} satisfies BehaviorFixtureV2;

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillsync-stage-"));
  await mkdir(join(root, "skill", "references"), { recursive: true });
  await writeFile(join(root, "skill", "SKILL.md"), "---\nname: review\ndescription: Review\n---\n");
  await writeFile(join(root, "skill", "references", "guide.md"), "guide");
  await writeFile(join(root, "events.jsonl"), "trace");
  return root;
}

describe("behavior fixture staging", () => {
  it("copies only the declared Skill and trace and cleans up idempotently", async () => {
    const fixtureRoot = await createFixture();
    const staged = await stageBehaviorFixture({
      fixtureRoot,
      manifest,
      skillPath: "skill",
      replayTracePath: "events.jsonl",
      runId: "run-1",
    });

    expect(await readFile(join(staged.stagedWorkspace, "skill", "SKILL.md"), "utf8")).toContain(
      "name: review",
    );
    expect(await readFile(staged.stagedTracePath, "utf8")).toBe("trace");
    await access(join(fixtureRoot, "skill", "SKILL.md"));

    await staged.cleanup();
    await staged.cleanup();
    await expect(access(staged.stagedWorkspace)).rejects.toThrow();
  });

  it("rejects symlinks instead of dereferencing outside the fixture root", async () => {
    const fixtureRoot = await createFixture();
    const outside = await mkdtemp(join(tmpdir(), "skillsync-stage-outside-"));
    const outsideFile = join(outside, "secret.txt");
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, join(fixtureRoot, "skill", "references", "outside.txt"));

    await expect(
      stageBehaviorFixture({
        fixtureRoot,
        manifest,
        skillPath: "skill",
        replayTracePath: "events.jsonl",
        runId: "run-1",
      }),
    ).rejects.toThrow(/staging-escape|symlink/i);
  });

  it("rejects declared paths that escape the fixture root", async () => {
    const fixtureRoot = await createFixture();

    await expect(
      stageBehaviorFixture({
        fixtureRoot,
        manifest,
        skillPath: "../outside",
        replayTracePath: "events.jsonl",
        runId: "run-1",
      }),
    ).rejects.toThrow(/staging-escape|fixture root|outside/i);
  });
});
