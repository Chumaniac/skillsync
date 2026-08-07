import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RunSpec } from "../../src/domain/behavior-v2";
import { ReplayBackend } from "../../src/sandbox/replay";

const inputDigest = "sha256:" + "a".repeat(64);
const outputDigest = "sha256:" + "b".repeat(64);

function trace(): string {
  return [
    {
      protocol: "skillsync.runner.v1",
      runId: "__SKILLSYNC_RUN_ID__",
      seq: 0,
      atMs: 0,
      type: "run.started",
      payload: { agent: "codex", skillPath: "skill", inputDigest: "__SKILLSYNC_INPUT_DIGEST__" },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: "__SKILLSYNC_RUN_ID__",
      seq: 1,
      atMs: 1,
      type: "fs.write",
      payload: { path: "workspace/review.md", bytes: 12, digest: outputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: "__SKILLSYNC_RUN_ID__",
      seq: 2,
      atMs: 2,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function makeSpec(tracePath: string): RunSpec {
  return {
    fixtureId: "replay-basic",
    fixtureRoot: "/tmp/fixture",
    stagedWorkspace: "/tmp/stage",
    skillPath: "/tmp/fixture/skill",
    agent: "codex",
    runId: "run-1",
    backend: "replay",
    replayTracePath: tracePath,
    limits: { timeoutMs: 30_000, memoryMb: 512, cpuLimit: 1, pidsLimit: 64 },
    network: { mode: "deny", allowedHosts: [] },
    allowedEnvironmentNames: [],
    invariants: {
      allowedWrites: ["workspace/review.md"],
      requiredOutputs: ["workspace/review.md"],
      forbiddenPaths: ["/Users/**"],
      allowedTools: [],
    },
    inputDigest,
  };
}

describe("Replay backend", () => {
  it("replays a trace without starting a process or mutating the trace", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-replay-"));
    const tracePath = join(root, "events.jsonl");
    await writeFile(tracePath, trace());
    const backend = new ReplayBackend();
    const spec = makeSpec(tracePath);
    const handle = await backend.provision(spec);
    const received: string[] = [];

    expect(await backend.checkAvailable(spec)).toEqual({ available: true });
    const result = await backend.execute(
      handle,
      spec,
      async (event) => {
        received.push(event.type);
      },
      new AbortController().signal,
    );

    expect(received).toEqual(["run.started", "fs.write", "run.finished"]);
    expect(result).toMatchObject({ processExitCode: 0, timedOut: false, protocolComplete: true });
    expect(result.finalFiles).toEqual([{ path: "workspace/review.md", bytes: 12, digest: outputDigest }]);
    expect(result.eventDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(backend.teardown(handle)).resolves.toMatchObject({ completed: true });
    await expect(backend.teardown(handle)).resolves.toMatchObject({ completed: true });
  });

  it("stops replay when the caller aborts", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-replay-abort-"));
    const tracePath = join(root, "events.jsonl");
    await writeFile(tracePath, trace());
    const backend = new ReplayBackend();
    const spec = makeSpec(tracePath);
    const handle = await backend.provision(spec);
    const controller = new AbortController();
    const received: string[] = [];

    const result = await backend.execute(
      handle,
      spec,
      async (event) => {
        received.push(event.type);
        controller.abort();
      },
      controller.signal,
    );

    expect(received).toEqual(["run.started"]);
    expect(result.protocolComplete).toBe(false);
  });

  it("produces deterministic event and virtual tree digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-replay-deterministic-"));
    const tracePath = join(root, "events.jsonl");
    await writeFile(tracePath, trace());
    const backend = new ReplayBackend();
    const spec = makeSpec(tracePath);
    const first = await backend.execute(
      await backend.provision(spec),
      spec,
      async () => undefined,
      new AbortController().signal,
    );
    const second = await backend.execute(
      await backend.provision(spec),
      spec,
      async () => undefined,
      new AbortController().signal,
    );

    expect(second.eventDigest).toBe(first.eventDigest);
    expect(second.finalFilesDigest).toBe(first.finalFilesDigest);
  });
});
