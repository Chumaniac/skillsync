import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import type { DigestFile } from "./digest.js";
import type { BehaviorFixtureV2 } from "./behavior-fixture.js";

export const BEHAVIOR_V2_LIMITS = {
  maxTimeoutMs: 600_000,
  maxMemoryMb: 4_096,
  maxCpuLimit: 4,
  maxPidsLimit: 256,
} as const;

export type SandboxPathMode = "workspace" | "sensitive";

export type RunSpec = {
  fixtureId: string;
  fixtureRoot: string;
  stagedWorkspace: string;
  skillPath: string;
  agent: string;
  runId: string;
  backend: "replay" | "docker";
  replayTracePath?: string;
  image?: string;
  limits: {
    timeoutMs: number;
    memoryMb: number;
    cpuLimit: number;
    pidsLimit: number;
  };
  network: {
    mode: "deny" | "allowlist";
    allowedHosts: string[];
  };
  allowedEnvironmentNames: string[];
  invariants: {
    allowedWrites: string[];
    requiredOutputs: string[];
    forbiddenPaths: string[];
    allowedTools: string[];
  };
  inputDigest: string;
};

export class BehaviorPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BehaviorPathError";
  }
}

function assertNoTraversal(input: string, label: string): string[] {
  if (input.includes("\0")) {
    throw new BehaviorPathError(`${label} contains a null byte`);
  }

  const normalized = input.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new BehaviorPathError(`${label} contains path traversal: ${input}`);
  }
  return segments;
}

export function normalizeSandboxPath(
  input: string,
  label: string,
  mode: SandboxPathMode,
): string {
  const segments = assertNoTraversal(input, label);
  const normalized = input.replaceAll("\\", "/");
  const drivePath = /^[A-Za-z]:/.test(normalized);
  const absolutePath = normalized.startsWith("/");

  if (drivePath || (mode === "workspace" && absolutePath)) {
    throw new BehaviorPathError(`${label} must remain inside the workspace: ${input}`);
  }

  const cleaned = segments.filter((segment) => segment !== "" && segment !== ".");
  if (cleaned.length === 0) {
    throw new BehaviorPathError(`${label} must not be empty`);
  }

  const result = cleaned.join("/");
  return mode === "sensitive" && absolutePath ? `/${result}` : result;
}

function matchSegment(pathSegment: string, patternSegment: string): boolean {
  if (!patternSegment.includes("*")) {
    return pathSegment === patternSegment;
  }

  const expression = patternSegment
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(pathSegment);
}

export function matchSandboxGlob(path: string, pattern: string): boolean {
  let normalizedPath: string;
  let normalizedPattern: string;
  try {
    normalizedPath = normalizeSandboxPath(path, "path", "workspace");
    normalizedPattern = normalizeSandboxPath(pattern, "pattern", "workspace");
  } catch {
    return false;
  }

  const pathSegments = normalizedPath.split("/");
  const patternSegments = normalizedPattern.split("/");
  const memo = new Map<string, boolean>();

  function visit(pathIndex: number, patternIndex: number): boolean {
    const key = `${pathIndex}:${patternIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let result: boolean;
    if (patternIndex === patternSegments.length) {
      result = pathIndex === pathSegments.length;
    } else if (patternSegments[patternIndex] === "**") {
      result =
        visit(pathIndex, patternIndex + 1) ||
        (pathIndex < pathSegments.length && visit(pathIndex + 1, patternIndex));
    } else {
      result =
        pathIndex < pathSegments.length &&
        matchSegment(pathSegments[pathIndex] ?? "", patternSegments[patternIndex] ?? "") &&
        visit(pathIndex + 1, patternIndex + 1);
    }

    memo.set(key, result);
    return result;
  }

  return visit(0, 0);
}

function assertInside(root: string, input: string, label: string, allowDot = false): string {
  const normalized = input.replaceAll("\\", "/");
  if (normalized.includes("\0") || isAbsolute(input) || /^[A-Za-z]:/.test(normalized)) {
    throw new BehaviorPathError(`${label} must remain inside the fixture root: ${input}`);
  }

  const candidate = resolve(root, input);
  const relativePath = relative(root, candidate);
  if (
    (!allowDot && relativePath === "") ||
    relativePath.startsWith("../") ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    throw new BehaviorPathError(`${label} must remain inside the fixture root: ${input}`);
  }
  return candidate;
}

export function resolveBehaviorFixturePath(
  fixtureRoot: string,
  input: string,
  label: string,
  allowDot = false,
): string {
  return assertInside(resolve(fixtureRoot), input, label, allowDot);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function computeBehaviorInputDigest(
  manifest: BehaviorFixtureV2,
  files: readonly DigestFile[],
): string {
  const normalizedFiles = files
    .map((file) => ({
      relativePath: normalizeSandboxPath(file.relativePath, "Skill file path", "workspace"),
      content: file.content.toString("base64"),
      mode: file.mode,
      isSymlink: file.isSymlink,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const canonical = stableValue({
    manifest,
    files: normalizedFiles,
  });
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${hash}`;
}

function assertDigest(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new BehaviorPathError(`${label} must be a sha256 digest`);
  }
}

export function buildRunSpec(input: {
  fixtureRoot: string;
  manifest: BehaviorFixtureV2;
  stagedWorkspace: string;
  runId: string;
  inputDigest: string;
}): RunSpec {
  const { manifest } = input;
  const skillPath = assertInside(input.fixtureRoot, manifest.skill_path, "skill_path", true);
  let replayTracePath: string | undefined;
  if (manifest.execution.backend === "replay") {
    const replayTrace = manifest.execution.replay_trace;
    if (!replayTrace) {
      throw new BehaviorPathError("replay backend requires replay_trace");
    }
    replayTracePath = assertInside(input.fixtureRoot, replayTrace, "replay_trace");
  }

  const allowedWrites = manifest.invariants.allowed_writes.map((path) =>
    normalizeSandboxPath(path, "allowed_writes", "workspace"),
  );
  const requiredOutputs = manifest.invariants.required_outputs.map((path) =>
    normalizeSandboxPath(path, "required_outputs", "workspace"),
  );
  const forbiddenPaths = manifest.invariants.forbidden_paths.map((path) =>
    normalizeSandboxPath(path, "forbidden_paths", path.startsWith("/") ? "sensitive" : "workspace"),
  );

  if (requiredOutputs.some((output) => !allowedWrites.some((pattern) => matchSandboxGlob(output, pattern)))) {
    throw new BehaviorPathError("required_outputs must be covered by allowed_writes");
  }

  assertDigest(input.inputDigest, "inputDigest");

  return {
    fixtureId: manifest.id,
    fixtureRoot: resolve(input.fixtureRoot),
    stagedWorkspace: resolve(input.stagedWorkspace),
    skillPath,
    agent: manifest.agent,
    runId: input.runId,
    backend: manifest.execution.backend,
    ...(replayTracePath ? { replayTracePath } : {}),
    ...(manifest.execution.image ? { image: manifest.execution.image } : {}),
    limits: {
      timeoutMs: manifest.execution.timeout_ms,
      memoryMb: manifest.execution.memory_mb,
      cpuLimit: manifest.execution.cpu_limit,
      pidsLimit: manifest.execution.pids_limit,
    },
    network: {
      mode: manifest.execution.network.mode,
      allowedHosts: [...manifest.execution.network.allowed_hosts],
    },
    allowedEnvironmentNames: [...manifest.execution.environment.allow],
    invariants: {
      allowedWrites,
      requiredOutputs,
      forbiddenPaths,
      allowedTools: [...manifest.invariants.allowed_tools],
    },
    inputDigest: input.inputDigest,
  };
}
