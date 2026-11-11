import { randomUUID } from "node:crypto";

import {
  buildRunSpec,
  computeBehaviorInputDigest,
  resolveBehaviorFixturePath,
  type RunSpec,
} from "../../domain/behavior-v2.js";
import {
  type BehaviorExecutionReport,
  type BehaviorFinding,
  evaluateExecution,
} from "../../domain/behavior-execution.js";
import {
  computeEventDigest,
  type RunnerEvent,
} from "../../domain/runner-events.js";
import { scanInventory } from "../../domain/inventory.js";
import { DockerBackend } from "../../sandbox/docker.js";
import { ReplayBackend } from "../../sandbox/replay.js";
import { stageBehaviorFixture } from "../../sandbox/staging.js";
import type {
  BackendAvailability,
  BackendExecutionResult,
  SandboxBackend,
  TeardownResult,
} from "../../sandbox/types.js";
import type { BehaviorFixtureV2 } from "../../domain/behavior-fixture.js";

const EMPTY_DIGEST = `sha256:${"0".repeat(64)}`;

export class BehaviorCommandError extends Error {
  readonly exitCode: 2 | 3 | 4;

  constructor(message: string, exitCode: 2 | 3 | 4) {
    super(message);
    this.name = "BehaviorCommandError";
    this.exitCode = exitCode;
  }
}

export type BehaviorV2TestOptions = {
  fixtureRoot: string;
  manifest: BehaviorFixtureV2;
  execute: boolean;
  backend?: string;
};

type V2Preflight = {
  status: "passed" | "failed";
  findings: BehaviorFinding[];
  inputDigest: string;
  skillRoot: string;
};

function finding(
  code: string,
  status: BehaviorFinding["status"],
  message: string,
  evidence: Array<Record<string, string>> = [],
): BehaviorFinding {
  return { code, status, message, evidence };
}

async function runV2Preflight(
  fixtureRoot: string,
  manifest: BehaviorFixtureV2,
): Promise<V2Preflight> {
  let skillRoot: string;
  try {
    skillRoot = resolveBehaviorFixturePath(fixtureRoot, manifest.skill_path, "skill_path", true);
  } catch (error: unknown) {
    throw new BehaviorCommandError(error instanceof Error ? error.message : String(error), 3);
  }

  const inventory = await scanInventory([
    { name: `behavior-${manifest.id}`, path: skillRoot, scope: "explicit" },
  ]);
  const findings: BehaviorFinding[] = [];
  if (inventory.skills.length !== 1) {
    findings.push(
      finding(
        "behavior.skill-not-found",
        "fail",
        "Fixture skill_path must resolve to exactly one Skill.",
        [{ path: skillRoot, discovered: String(inventory.skills.length) }],
      ),
    );
    return {
      status: "failed",
      findings,
      inputDigest: EMPTY_DIGEST,
      skillRoot,
    };
  }

  const inputDigest = computeBehaviorInputDigest(manifest, inventory.skills[0].files);
  findings.push(
    finding("behavior.skill-found", "pass", "Fixture skill_path resolves to exactly one Skill.", [
      { path: skillRoot, digest: inputDigest },
    ]),
  );
  return { status: "passed", findings, inputDigest, skillRoot };
}

function emptyExecutionResult(): BackendExecutionResult {
  return {
    processExitCode: 1,
    timedOut: false,
    protocolComplete: false,
    finalFiles: [],
    eventDigest: computeEventDigest([]),
    finalFilesDigest: EMPTY_DIGEST,
  };
}

function publicEvidence(evaluation: ReturnType<typeof evaluateExecution>): BehaviorExecutionReport["execution"]["evidence"] {
  return {
    event_count: evaluation.evidence.eventCount,
    redacted: evaluation.evidence.redacted,
    writes: evaluation.evidence.writes,
    tools: evaluation.evidence.tools,
    network: evaluation.evidence.network,
    teardown: evaluation.evidence.teardown
      ? {
          completed: evaluation.evidence.teardown.completed,
          resource_id: evaluation.evidence.teardown.resourceId,
        }
      : null,
  };
}

function notRunReport(
  fixtureRoot: string,
  manifest: BehaviorFixtureV2,
  preflight: V2Preflight,
): BehaviorExecutionReport {
  return {
    schema_version: 2,
    fixture: { id: manifest.id, schema_version: 2, input_digest: preflight.inputDigest },
    preflight: { status: preflight.status, findings: preflight.findings },
    execution: {
      status: "not-run",
      backend: null,
      run_id: null,
      started_at: null,
      finished_at: null,
      staged_digest: null,
      event_digest: null,
      exit_code: preflight.status === "passed" ? 0 : 1,
      reason: "execute-flag-required",
      findings: [
        finding(
          "behavior.execution-not-run",
          "not-run",
          "Agent execution was not run because --execute was not supplied.",
          [{ execution: "not-run", fixture: fixtureRoot }],
        ),
      ],
      evidence: {
        event_count: 0,
        redacted: true,
        writes: [],
        tools: [],
        network: [],
        teardown: null,
      },
    },
  };
}

export function publicAvailabilityFinding(
  reason: BackendAvailability["reason"],
): "sandbox.backend-unavailable" | "sandbox.image-contract-invalid" {
  return reason === "image-contract-invalid"
    ? "sandbox.image-contract-invalid"
    : "sandbox.backend-unavailable";
}

function blockedBackendReport(
  manifest: BehaviorFixtureV2,
  preflight: V2Preflight,
  backend: SandboxBackend["name"],
  stagedDigest: string,
  startedAt: string,
  availabilityReason: BackendAvailability["reason"],
): BehaviorExecutionReport {
  const publicFinding = publicAvailabilityFinding(availabilityReason);
  const reason = availabilityReason ?? "unknown";
  const message = publicFinding === "sandbox.image-contract-invalid"
    ? "Runner image does not satisfy the SkillSync image contract."
    : `Sandbox backend is unavailable: ${reason}.`;
  return {
    schema_version: 2,
    fixture: { id: manifest.id, schema_version: 2, input_digest: preflight.inputDigest },
    preflight: { status: preflight.status, findings: preflight.findings },
    execution: {
      status: "blocked",
      backend,
      run_id: null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      staged_digest: stagedDigest,
      event_digest: null,
      exit_code: 4,
      reason: publicFinding,
      findings: [
        finding(
          publicFinding,
          "fail",
          message,
          [{ backend, reason }],
        ),
      ],
      evidence: {
        event_count: 0,
        redacted: true,
        writes: [],
        tools: [],
        network: [],
        teardown: null,
      },
    },
  };
}

function runnerErrorFinding(error: unknown): BehaviorFinding | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (code === "runner.protocol-invalid" || code === "runner.event-too-large") {
      return finding(code, "fail", error instanceof Error ? error.message : String(error));
    }
  }
  return error
    ? finding(
        "execution.runner-failed",
        "fail",
        error instanceof Error ? error.message : String(error),
      )
    : undefined;
}

async function executeBackend(
  fixtureRoot: string,
  manifest: BehaviorFixtureV2,
  preflight: V2Preflight,
  backend: SandboxBackend,
): Promise<BehaviorExecutionReport> {
  const runId = randomUUID();
  let staged: Awaited<ReturnType<typeof stageBehaviorFixture>> | undefined;
  try {
    staged = await stageBehaviorFixture({
      fixtureRoot,
      manifest,
      skillPath: manifest.skill_path,
      replayTracePath: manifest.execution.replay_trace,
      runId,
    });
  } catch (error: unknown) {
    throw new BehaviorCommandError(error instanceof Error ? error.message : String(error), 3);
  }

  const startedAt = new Date().toISOString();
  let handle: Awaited<ReturnType<SandboxBackend["provision"]>> | undefined;
  let teardown: TeardownResult = { completed: true, resourceId: runId };
  let result = emptyExecutionResult();
  const events: RunnerEvent[] = [];
  let executionError: unknown;
  let spec: RunSpec;
  try {
    spec = buildRunSpec({
      fixtureRoot,
      manifest,
      stagedWorkspace: staged.stagedWorkspace,
      runId,
      inputDigest: staged.inputDigest,
    });
  } catch (error: unknown) {
    await staged.cleanup();
    throw new BehaviorCommandError(error instanceof Error ? error.message : String(error), 3);
  }

  const executionSpec: RunSpec = staged.stagedTracePath
    ? { ...spec, replayTracePath: staged.stagedTracePath }
    : spec;
  try {
    const availability = await backend.checkAvailable(executionSpec);
    if (!availability.available) {
      const report = blockedBackendReport(
        manifest,
        preflight,
        backend.name,
        staged.inputDigest,
        startedAt,
        availability.reason,
      );
      await staged.cleanup();
      return report;
    }

    handle = await backend.provision(executionSpec);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), spec.limits.timeoutMs);
    try {
      result = await backend.execute(
        handle,
        executionSpec,
        async (event) => {
          events.push(event);
        },
        controller.signal,
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: unknown) {
    executionError = error;
  } finally {
    if (handle) {
      try {
        teardown = await backend.teardown(handle);
      } catch (error: unknown) {
        teardown = {
          completed: false,
          resourceId: handle.id,
          errorCode: error instanceof Error ? error.message : "teardown-failed",
        };
      }
    }
  }

  const evaluation = evaluateExecution(spec, events, result, teardown);
  const extraFinding = runnerErrorFinding(executionError);
  if (extraFinding) {
    evaluation.findings.unshift(extraFinding);
    evaluation.status = "failed";
  }
  const report: BehaviorExecutionReport = {
    schema_version: 2,
    fixture: { id: manifest.id, schema_version: 2, input_digest: staged.inputDigest },
    preflight: { status: preflight.status, findings: preflight.findings },
    execution: {
      status: evaluation.status,
      backend: backend.name,
      run_id: runId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      staged_digest: staged.inputDigest,
      event_digest: events.length > 0 || result.protocolComplete ? result.eventDigest : null,
      exit_code: evaluation.status === "passed" ? 0 : 1,
      ...(evaluation.findings[0] ? { reason: evaluation.findings[0].code } : {}),
      findings: evaluation.findings,
      evidence: publicEvidence(evaluation),
    },
  };
  await staged.cleanup();
  return report;
}

export async function runBehaviorV2Test(
  options: BehaviorV2TestOptions,
): Promise<BehaviorExecutionReport> {
  const preflight = await runV2Preflight(options.fixtureRoot, options.manifest);
  if (!options.execute) {
    return notRunReport(options.fixtureRoot, options.manifest, preflight);
  }
  if (!options.backend) {
    throw new BehaviorCommandError("test --execute requires --backend <replay|docker>", 2);
  }
  if (options.backend !== "replay" && options.backend !== "docker") {
    throw new BehaviorCommandError(`Unsupported behavior backend: ${options.backend}`, 2);
  }
  if (options.backend !== options.manifest.execution.backend) {
    throw new BehaviorCommandError(
      `Behavior backend mismatch: fixture declares ${options.manifest.execution.backend}, CLI requested ${options.backend}`,
      2,
    );
  }
  if (preflight.status !== "passed") {
    return notRunReport(options.fixtureRoot, options.manifest, preflight);
  }
  if (options.backend === "docker") {
    return executeBackend(options.fixtureRoot, options.manifest, preflight, new DockerBackend());
  }
  return executeBackend(options.fixtureRoot, options.manifest, preflight, new ReplayBackend());
}
