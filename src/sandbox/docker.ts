import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";

import {
  computeEventDigest,
  parseRunnerTrace,
  RunnerProtocolError,
  type RunnerEvent,
} from "../domain/runner-events.js";
import type { RunSpec } from "../domain/behavior-v2.js";
import {
  parseRunnerImageConfig,
  RunnerImageContractError,
} from "./runner-contract.js";
import {
  SpawnCommandRunner,
  type CommandRunner,
  type ProcessResult,
  type ProcessSpec,
} from "./command.js";
import type {
  BackendAvailability,
  BackendExecutionResult,
  SandboxBackend,
  SandboxHandle,
  TeardownResult,
  VirtualFileObservation,
} from "./types.js";
import { scanStagedWorkspace, workspaceTreeDelta } from "./workspace-tree.js";
import type { WorkspaceTree } from "./types.js";

const AVAILABILITY_TIMEOUT_MS = 5_000;
const CONTROL_TIMEOUT_MS = 5_000;
const TMPFS_SPEC = "/tmp:rw,noexec,nosuid,nodev,size=64m";

export type DockerBackendOptions = {
  dockerPath?: string;
  runner?: CommandRunner;
  now?: () => string;
};

function finalFilesDigest(files: readonly VirtualFileObservation[]): string {
  const canonical = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

function emptyExecutionResult(overrides: Partial<BackendExecutionResult> = {}): BackendExecutionResult {
  return {
    processExitCode: null,
    timedOut: false,
    protocolComplete: false,
    finalFiles: [],
    eventDigest: computeEventDigest([]),
    finalFilesDigest: finalFilesDigest([]),
    ...overrides,
  };
}

type DockerCreateFailureCategory =
  | "bind-mount-invalid"
  | "user-unavailable"
  | "runtime-option-invalid"
  | "resource-limit-invalid"
  | "container-name-conflict"
  | "unknown-control-error";

function classifyDockerCreateFailure(stderr: string): DockerCreateFailureCategory {
  if (/invalid mount config for type ["']?bind|bind source path does not exist/i.test(stderr)) {
    return "bind-mount-invalid";
  }
  return "unknown-control-error";
}

function dockerCreateError(result: ProcessResult): Error {
  // Docker stderr can contain image names, paths, or provider-controlled data.
  // Derive only a finite category; never return raw process output in reports.
  const category = classifyDockerCreateFailure(result.stderr);
  return new Error(`Docker container creation failed: ${category}`);
}

function containerName(runId: string): string {
  const digest = createHash("sha256").update(runId).digest("hex").slice(0, 24);
  return `skillsync-${digest}`;
}

function explicitContainerEnvironment(spec: RunSpec): string[] {
  return [
    "--env", `SKILLSYNC_RUN_ID=${spec.runId}`,
    "--env", `SKILLSYNC_INPUT_DIGEST=${spec.inputDigest}`,
    "--env", "SKILLSYNC_PROTOCOL=skillsync.runner.v1",
    "--env", "SKILLSYNC_SKILL_PATH=skill",
    "--env", `SKILLSYNC_AGENT=${spec.agent}`,
  ];
}

function createArgs(spec: RunSpec): string[] {
  if (!spec.image) {
    throw new Error("Docker execution requires an image");
  }
  if (spec.network.mode !== "deny") {
    throw new Error("Docker backend supports only network.mode: deny");
  }
  return [
    "create",
    "--name", containerName(spec.runId),
    "--user", "65532:65532",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--network", "none",
    "--memory", `${spec.limits.memoryMb}m`,
    "--cpus", String(spec.limits.cpuLimit),
    "--pids-limit", String(spec.limits.pidsLimit),
    "--mount", `type=bind,src=${spec.stagedWorkspace},dst=/workspace,rw`,
    "--tmpfs", TMPFS_SPEC,
    "--workdir", "/workspace",
    "--entrypoint", "/usr/local/bin/skillsync-runner",
    ...explicitContainerEnvironment(spec),
    spec.image,
  ];
}

function asProcessSpec(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal): ProcessSpec {
  return { executable, args, timeoutMs, signal };
}

function validateHandle(handle: SandboxHandle, spec: RunSpec): void {
  if (handle.backend !== "docker" || handle.runId !== spec.runId || !handle.id) {
    throw new Error("Docker handle does not match the requested RunSpec");
  }
}

function finalFilesFromEvents(events: readonly RunnerEvent[]): VirtualFileObservation[] {
  const files = new Map<string, VirtualFileObservation>();
  for (const event of events) {
    if (event.type === "fs.write") {
      files.set(event.payload.path, {
        path: event.payload.path,
        bytes: event.payload.bytes,
        digest: event.payload.digest,
      });
    }
  }
  return [...files.values()];
}

async function scanWorkspaceIfPresent(root: string): Promise<WorkspaceTree | null> {
  try {
    await lstat(root);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return scanStagedWorkspace(root);
}

export class DockerBackend implements SandboxBackend {
  readonly name = "docker" as const;
  private readonly dockerPath: string;
  private readonly runner: CommandRunner;
  private readonly now: () => string;
  private readonly workspaceBaselines = new Map<string, WorkspaceTree | null>();

  constructor(options: DockerBackendOptions = {}) {
    this.dockerPath = options.dockerPath ?? "docker";
    this.runner = options.runner ?? new SpawnCommandRunner();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async checkAvailable(spec: RunSpec): Promise<BackendAvailability> {
    if (spec.backend !== "docker") {
      return { available: false, reason: "runtime-missing" };
    }
    if (spec.network.mode !== "deny") {
      return { available: false, reason: "unsupported-network-mode" };
    }
    if (!spec.image) {
      return { available: false, reason: "image-missing" };
    }

    const version = await this.runner.run(
      asProcessSpec(this.dockerPath, ["version", "--format", "{{.Server.Version}}"], AVAILABILITY_TIMEOUT_MS),
    );
    if (version.exitCode !== 0 || version.timedOut || version.outputLimitExceeded) {
      return { available: false, reason: "runtime-missing" };
    }

    const image = await this.runner.run(asProcessSpec(
      this.dockerPath,
      ["image", "inspect", "--format", "{{json .Config}}", spec.image],
      AVAILABILITY_TIMEOUT_MS,
    ));
    if (image.exitCode !== 0 || image.timedOut || image.outputLimitExceeded) {
      return { available: false, reason: "image-missing" };
    }
    try {
      parseRunnerImageConfig(image.stdout);
    } catch (error: unknown) {
      if (error instanceof RunnerImageContractError) {
        return { available: false, reason: "image-contract-invalid" };
      }
      throw error;
    }
    return { available: true };
  }

  async provision(spec: RunSpec): Promise<SandboxHandle> {
    if (spec.backend !== "docker") {
      throw new Error("Docker backend received a non-Docker RunSpec");
    }
    const workspaceBaseline = await scanWorkspaceIfPresent(spec.stagedWorkspace);
    const created = await this.runner.run(
      asProcessSpec(this.dockerPath, createArgs(spec), CONTROL_TIMEOUT_MS),
    );
    if (created.exitCode !== 0 || created.timedOut || created.outputLimitExceeded) {
      throw dockerCreateError(created);
    }
    const id = created.stdout.trim().split(/\s+/, 1)[0] ?? "";
    if (!id) {
      throw new Error("Docker container creation returned no container id");
    }
    this.workspaceBaselines.set(id, workspaceBaseline);
    return { id, backend: "docker", runId: spec.runId, startedAt: this.now() };
  }

  async execute(
    handle: SandboxHandle,
    spec: RunSpec,
    onEvent: (event: RunnerEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<BackendExecutionResult> {
    validateHandle(handle, spec);
    const attached = await this.runner.run(
      asProcessSpec(this.dockerPath, ["start", "--attach", handle.id], spec.limits.timeoutMs, signal),
    );
    if (attached.outputLimitExceeded) {
      throw new RunnerProtocolError(
        "runner.event-too-large",
        "Docker runner output exceeded the bounded event or stderr limit",
      );
    }
    if (attached.timedOut || signal.aborted) {
      await this.kill(handle.id);
      return emptyExecutionResult({ timedOut: true });
    }

    const parsed = parseRunnerTrace(attached.stdout, {
      runId: spec.runId,
      inputDigest: spec.inputDigest,
    });
    if (attached.exitCode !== parsed.terminalExitCode) {
      throw new RunnerProtocolError(
        "runner.protocol-invalid",
        "Runner terminal exitCode does not match the container exit code",
      );
    }
    const workspaceAfter = await scanWorkspaceIfPresent(spec.stagedWorkspace);
    const workspaceBaseline = this.workspaceBaselines.get(handle.id);
    const workspaceDelta = workspaceBaseline && workspaceAfter
      ? workspaceTreeDelta(workspaceBaseline, workspaceAfter)
      : undefined;
    for (const event of parsed.events) {
      await onEvent(event);
    }
    const finalFiles = finalFilesFromEvents(parsed.events);
    return {
      processExitCode: attached.exitCode,
      timedOut: false,
      protocolComplete: parsed.protocolComplete,
      finalFiles,
      eventDigest: parsed.eventDigest,
      finalFilesDigest: finalFilesDigest(finalFiles),
      ...(workspaceAfter && workspaceDelta
        ? {
            workspaceTree: workspaceAfter,
            workspaceChanges: workspaceDelta.changed,
            workspaceDeletedPaths: workspaceDelta.deleted,
          }
        : {}),
    };
  }

  async teardown(handle: SandboxHandle): Promise<TeardownResult> {
    const removed = await this.runner.run(
      asProcessSpec(this.dockerPath, ["rm", "--force", handle.id], CONTROL_TIMEOUT_MS),
    );
    if (removed.exitCode === 0 || /no such container/i.test(removed.stderr)) {
      this.workspaceBaselines.delete(handle.id);
      return { completed: true, resourceId: handle.id };
    }
    return {
      completed: false,
      resourceId: handle.id,
      errorCode: "sandbox.teardown-failed",
    };
  }

  private async kill(id: string): Promise<void> {
    await this.runner.run(asProcessSpec(this.dockerPath, ["kill", id], CONTROL_TIMEOUT_MS));
  }
}
