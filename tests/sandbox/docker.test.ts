import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RunSpec } from "../../src/domain/behavior-v2";
import {
  SpawnCommandRunner,
  type ProcessResult,
  type ProcessSpec,
  type CommandRunner,
} from "../../src/sandbox/command";
import { DockerBackend } from "../../src/sandbox/docker";
import { RUNNER_ENTRYPOINT } from "../../src/sandbox/runner-contract";

const inputDigest = `sha256:${"a".repeat(64)}`;
const image = `ghcr.io/skillsync/runner@sha256:${"b".repeat(64)}`;
const outputDigest = `sha256:${"c".repeat(64)}`;
const validImageConfig = {
  Labels: {
    "org.skillsync.runner.protocol": "skillsync.runner.v1",
    "org.skillsync.runner.contract": "1",
    "org.skillsync.runner.entrypoint": RUNNER_ENTRYPOINT,
  },
  Entrypoint: [RUNNER_ENTRYPOINT],
  Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8"],
};

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputLimitExceeded: false,
    ...overrides,
  };
}

class FakeRunner implements CommandRunner {
  readonly calls: ProcessSpec[] = [];
  private readonly responses: Array<ProcessResult | ((spec: ProcessSpec) => ProcessResult)>;

  constructor(responses: Array<ProcessResult | ((spec: ProcessSpec) => ProcessResult)> = []) {
    this.responses = responses;
  }

  async run(spec: ProcessSpec): Promise<ProcessResult> {
    this.calls.push(spec);
    const response = this.responses.shift();
    return typeof response === "function" ? response(spec) : response ?? result();
  }
}

function makeSpec(overrides: Partial<RunSpec> = {}): RunSpec {
  return {
    fixtureId: "docker-contract",
    fixtureRoot: "/tmp/skillsync-fixture",
    stagedWorkspace: "/tmp/skillsync-stage/run-1",
    skillPath: "/tmp/skillsync-fixture/skill",
    agent: "codex",
    runId: "run-1",
    backend: "docker",
    image,
    limits: { timeoutMs: 30_000, memoryMb: 512, cpuLimit: 1, pidsLimit: 64 },
    network: { mode: "deny", allowedHosts: [] },
    allowedEnvironmentNames: [],
    invariants: {
      allowedWrites: ["workspace/review.md"],
      requiredOutputs: ["workspace/review.md"],
      forbiddenPaths: ["/Users/**", "workspace/.secrets/**"],
      allowedTools: [],
    },
    inputDigest,
    ...overrides,
  };
}

function trace(spec: RunSpec): string {
  return [
    {
      protocol: "skillsync.runner.v1",
      runId: spec.runId,
      seq: 0,
      atMs: 0,
      type: "run.started",
      payload: { agent: spec.agent, skillPath: "skill", inputDigest: spec.inputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: spec.runId,
      seq: 1,
      atMs: 1,
      type: "fs.write",
      payload: { path: "workspace/review.md", bytes: 12, digest: outputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: spec.runId,
      seq: 2,
      atMs: 2,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function traceWithWrite(spec: RunSpec, digest: string, bytes: number): string {
  return [
    {
      protocol: "skillsync.runner.v1",
      runId: spec.runId,
      seq: 0,
      atMs: 0,
      type: "run.started",
      payload: { agent: spec.agent, skillPath: "skill", inputDigest: spec.inputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: spec.runId,
      seq: 1,
      atMs: 1,
      type: "fs.write",
      payload: { path: "workspace/review.md", bytes, digest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: spec.runId,
      seq: 2,
      atMs: 2,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function commandNames(runner: FakeRunner): string[] {
  return runner.calls.map((call) => call.args[0] ?? "");
}

describe("DockerBackend", () => {
  it("runs control commands with a fixed environment and no ambient HOME", async () => {
    const runner = new SpawnCommandRunner();
    const execution = await runner.run({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(process.env.HOME ?? 'absent')"],
      timeoutMs: 2_000,
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.stdout).toBe("absent");
  });

  it("fails closed for unavailable runtime or local image without pulling", async () => {
    const runtimeRunner = new FakeRunner([result({ exitCode: 1, stderr: "daemon unavailable" })]);
    const runtimeBackend = new DockerBackend({ runner: runtimeRunner, dockerPath: "/usr/local/bin/docker" });

    await expect(runtimeBackend.checkAvailable(makeSpec())).resolves.toEqual({
      available: false,
      reason: "runtime-missing",
    });
    expect(commandNames(runtimeRunner)).toEqual(["version"]);

    const imageRunner = new FakeRunner([result(), result({ exitCode: 1, stderr: "No such image" })]);
    const imageBackend = new DockerBackend({ runner: imageRunner });
    await expect(imageBackend.checkAvailable(makeSpec())).resolves.toEqual({
      available: false,
      reason: "image-missing",
    });
    expect(commandNames(imageRunner)).toEqual(["version", "image"]);
    expect(imageRunner.calls.every((call) => call.args[0] !== "pull")).toBe(true);
    expect(imageRunner.calls.every((call) => !call.args.includes("HOME"))).toBe(true);
  });

  it("requires a valid Runner image contract during availability checks", async () => {
    const validRunner = new FakeRunner([
      result(),
      result({ stdout: JSON.stringify(validImageConfig) }),
    ]);
    const validBackend = new DockerBackend({ runner: validRunner });

    await expect(validBackend.checkAvailable(makeSpec())).resolves.toEqual({ available: true });
    expect(validRunner.calls[1]?.args).toEqual([
      "image",
      "inspect",
      "--format",
      "{{json .Config}}",
      image,
    ]);

    const invalidRunner = new FakeRunner([result(), result({ stdout: "{}" })]);
    const invalidBackend = new DockerBackend({ runner: invalidRunner });
    await expect(invalidBackend.checkAvailable(makeSpec())).resolves.toEqual({
      available: false,
      reason: "image-contract-invalid",
    });
    expect(commandNames(invalidRunner)).toEqual(["version", "image"]);
  });

  it("rejects allowlist networking before invoking Docker", async () => {
    const runner = new FakeRunner();
    const backend = new DockerBackend({ runner });

    await expect(
      backend.checkAvailable(
        makeSpec({ network: { mode: "allowlist", allowedHosts: ["api.example.com"] } }),
      ),
    ).resolves.toEqual({ available: false, reason: "unsupported-network-mode" });
    expect(runner.calls).toHaveLength(0);
  });

  it("creates a non-root, networkless, read-only container with explicit argv", async () => {
    const runner = new FakeRunner([result({ stdout: "container-123\n" })]);
    const backend = new DockerBackend({ runner, dockerPath: "/usr/local/bin/docker" });
    const spec = makeSpec({ runId: "run-with-safe-argv" });

    await expect(backend.provision(spec)).resolves.toMatchObject({
      id: "container-123",
      backend: "docker",
    });

    const call = runner.calls[0];
    expect(call.executable).toBe("/usr/local/bin/docker");
    expect(call.args[0]).toBe("create");
    expect(call.args).toEqual(expect.arrayContaining([
      "--user", "65532:65532",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true",
      "--network", "none",
      "--memory", "512m",
      "--cpus", "1",
      "--pids-limit", "64",
      "--workdir", "/workspace",
      "--entrypoint", RUNNER_ENTRYPOINT,
      "--env", `SKILLSYNC_RUN_ID=${spec.runId}`,
      "--env", `SKILLSYNC_INPUT_DIGEST=${inputDigest}`,
      "--env", "SKILLSYNC_PROTOCOL=skillsync.runner.v1",
      "--env", "SKILLSYNC_SKILL_PATH=skill",
      image,
    ]));
    expect(call.args.join(" ")).toContain("type=bind,src=/tmp/skillsync-stage/run-1,dst=/workspace,rw");
    expect(call.args.join(" ")).toContain("/tmp:rw,noexec,nosuid,nodev,size=64m");
    expect(call.args.join(" ")).not.toMatch(/pull|\/Users|docker\.sock|SSH_AUTH_SOCK|HOME=/i);
    expect(call.args).not.toContain("/bin/sh");
  });

  it("classifies bind-mount create failures without exposing the source path", async () => {
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /private/tenant-a/skillsync-stage',
    })]);
    const backend = new DockerBackend({ runner });

    await expect(backend.provision(makeSpec())).rejects.toThrowError(
      new Error("Docker container creation failed: bind-mount-invalid"),
    );
  });

  it("classifies unavailable Docker users without exposing the user value", async () => {
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: "unable to find user private-user-token: no matching entries in passwd file",
    })]);
    const backend = new DockerBackend({ runner });

    await expect(backend.provision(makeSpec())).rejects.toThrowError(
      new Error("Docker container creation failed: user-unavailable"),
    );
  });

  it("classifies invalid Docker runtime options without exposing the runtime value", async () => {
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: "Error response from daemon: unknown or invalid runtime name: private-runtime-token",
    })]);
    const backend = new DockerBackend({ runner });

    await expect(backend.provision(makeSpec())).rejects.toThrowError(
      new Error("Docker container creation failed: runtime-option-invalid"),
    );
  });

  it("classifies invalid Docker resource limits without exposing the workspace path", async () => {
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: "Error response from daemon: minimum memory limit allowed is 6MB for /private/tenant-a/workspace",
    })]);
    const backend = new DockerBackend({ runner });

    await expect(backend.provision(makeSpec())).rejects.toThrowError(
      new Error("Docker container creation failed: resource-limit-invalid"),
    );
  });

  it("classifies Docker container name conflicts without exposing the name", async () => {
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: 'Conflict. The container name "/skillsync-private-token" is already in use by container "abcdef".',
    })]);
    const backend = new DockerBackend({ runner });

    await expect(backend.provision(makeSpec())).rejects.toThrowError(
      new Error("Docker container creation failed: container-name-conflict"),
    );
  });

  it("keeps generic runtime-not-found stderr in the unknown category", async () => {
    const fakeSecret = "private-runtime-token";
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: `${fakeSecret}: runtime plugin not found while loading /private/control-plane`,
    })]);
    const backend = new DockerBackend({ runner });

    const error = await backend.provision(makeSpec()).then(
      () => new Error("expected Docker container creation to fail"),
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("Docker container creation did not return an Error");
    }
    expect(error.message).toBe("Docker container creation failed: unknown-control-error");
    expect(error.message).not.toContain(fakeSecret);
  });

  it("keeps generic resource-limit stderr in the unknown category", async () => {
    const fakeSecret = "private-limit-token";
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: `${fakeSecret}: memory limit threshold reached for /private/control-plane`,
    })]);
    const backend = new DockerBackend({ runner });

    const error = await backend.provision(makeSpec()).then(
      () => new Error("expected Docker container creation to fail"),
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("Docker container creation did not return an Error");
    }
    expect(error.message).toBe("Docker container creation failed: unknown-control-error");
    expect(error.message).not.toContain(fakeSecret);
  });

  it("uses an unknown category without exposing arbitrary Docker stderr", async () => {
    const fakeSecret = "secret-provider-token";
    const runner = new FakeRunner([result({
      exitCode: 1,
      stderr: `${fakeSecret} /workspace/private-config`,
    })]);
    const backend = new DockerBackend({ runner });

    const error = await backend.provision(makeSpec()).then(
      () => new Error("expected Docker container creation to fail"),
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("Docker container creation did not return an Error");
    }
    expect(error.message).toBe("Docker container creation failed: unknown-control-error");
    expect(error.message).not.toContain(fakeSecret);
  });

  it("attaches, parses bounded events, and tears down the exact container", async () => {
    const spec = makeSpec();
    const runner = new FakeRunner([
      result({ stdout: "container-123\n" }),
      result({ stdout: trace(spec), exitCode: 0 }),
      result(),
    ]);
    const backend = new DockerBackend({ runner });
    const handle = await backend.provision(spec);
    const received: string[] = [];

    const execution = await backend.execute(
      handle,
      spec,
      async (event) => {
        received.push(event.type);
      },
      new AbortController().signal,
    );

    expect(received).toEqual(["run.started", "fs.write", "run.finished"]);
    expect(execution).toMatchObject({
      processExitCode: 0,
      timedOut: false,
      protocolComplete: true,
      finalFiles: [{ path: "workspace/review.md", bytes: 12, digest: outputDigest }],
    });
    expect(commandNames(runner)).toEqual(["create", "start"]);
    expect(runner.calls[1]?.args).toEqual(["start", "--attach", "container-123"]);
    await expect(backend.teardown(handle)).resolves.toMatchObject({ completed: true });
    expect(commandNames(runner)).toEqual(["create", "start", "rm"]);
  });

  it("captures physical workspace changes independently from Runner events", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-docker-tree-"));
    try {
      const content = "review output";
      const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      await writeFile(join(root, "input.md"), "input", "utf8");
      const spec = makeSpec({ stagedWorkspace: root });
      const runner = new FakeRunner([
        result({ stdout: "container-tree\n" }),
        (call) => {
          if (call.args[0] === "start") {
            writeFileSync(join(root, "review.md"), content, "utf8");
          }
          return result({ stdout: traceWithWrite(spec, digest, Buffer.byteLength(content)) });
        },
      ]);
      const backend = new DockerBackend({ runner });
      const handle = await backend.provision(spec);
      const execution = await backend.execute(
        handle,
        spec,
        async () => undefined,
        new AbortController().signal,
      );

      expect(execution.workspaceChanges).toEqual([
        { path: "workspace/review.md", bytes: content.length, digest },
      ]);
      expect(execution.workspaceDeletedPaths).toEqual([]);
      await backend.teardown(handle);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a terminal exit code that disagrees with the container exit code", async () => {
    const spec = makeSpec();
    const runner = new FakeRunner([
      result({ stdout: "container-mismatch\n" }),
      result({ stdout: trace(spec), exitCode: 1 }),
    ]);
    const backend = new DockerBackend({ runner });
    const handle = await backend.provision(spec);
    const received: string[] = [];

    await expect(
      backend.execute(
        handle,
        spec,
        async (event) => {
          received.push(event.type);
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/runner\.protocol-invalid/);
    expect(received).toEqual([]);
  });

  it("kills the exact container on timeout and makes teardown idempotent", async () => {
    const spec = makeSpec();
    const runner = new FakeRunner([
      result({ stdout: "container-timeout\n" }),
      result({ exitCode: null, timedOut: true }),
      result(),
      result({ exitCode: 1, stderr: "No such container: container-timeout" }),
    ]);
    const backend = new DockerBackend({ runner });
    const handle = await backend.provision(spec);

    const execution = await backend.execute(
      handle,
      spec,
      async () => undefined,
      new AbortController().signal,
    );

    expect(execution).toMatchObject({ timedOut: true, protocolComplete: false });
    expect(commandNames(runner)).toEqual(["create", "start", "kill"]);
    expect(runner.calls[2]?.args).toEqual(["kill", "container-timeout"]);
    await expect(backend.teardown(handle)).resolves.toMatchObject({ completed: true });
    await expect(backend.teardown(handle)).resolves.toMatchObject({ completed: true });
    expect(commandNames(runner)).toEqual(["create", "start", "kill", "rm", "rm"]);
  });

  it("rejects handles from another run before starting a container", async () => {
    const runner = new FakeRunner();
    const backend = new DockerBackend({ runner });
    const spec = makeSpec();

    await expect(
      backend.execute(
        { id: "other", backend: "docker", runId: "other-run", startedAt: new Date(0).toISOString() },
        spec,
        async () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/handle does not match/i);
    expect(runner.calls).toHaveLength(0);
  });
});
