import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const RUNNER = "runner/reference/runner.mjs";
const inputDigest = `sha256:${"a".repeat(64)}`;

async function runReferenceRunner(environment: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-reference-runner-test-"));
  try {
    await mkdir(join(root, "skill"), { recursive: true });
    await writeFile(join(root, "skill", "SKILL.md"), "# Inert test Skill\n", "utf8");
    return await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [RUNNER], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          ...environment,
          SKILLSYNC_WORKSPACE: root,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("reference Runner", () => {
  it("emits bounded read evidence and a matching terminal exit code", async () => {
    const result = await runReferenceRunner({
      SKILLSYNC_PROTOCOL: "skillsync.runner.v1",
      SKILLSYNC_RUN_ID: "reference-run",
      SKILLSYNC_INPUT_DIGEST: inputDigest,
      SKILLSYNC_AGENT: "codex",
      SKILLSYNC_SKILL_PATH: "skill",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(5);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.call",
      "fs.read",
      "tool.call",
      "run.finished",
    ]);
    expect(events.at(-1)).toMatchObject({
      runId: "reference-run",
      seq: 4,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    });
    expect(result.stdout).not.toContain("Inert test Skill");
  });

  it("fails closed when the explicit input contract is incomplete", async () => {
    const result = await runReferenceRunner({
      SKILLSYNC_PROTOCOL: "skillsync.runner.v1",
      SKILLSYNC_RUN_ID: "reference-run",
      SKILLSYNC_INPUT_DIGEST: inputDigest,
      SKILLSYNC_AGENT: "codex",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("skillsync-runner: invalid input contract\n");
  });
});
