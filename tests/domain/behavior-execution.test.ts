import { describe, expect, it } from "vitest";

import { computeEventDigest, parseRunnerTrace, type RunnerEvent } from "../../src/domain/runner-events";
import type { RunSpec } from "../../src/domain/behavior-v2";
import { evaluateExecution } from "../../src/domain/behavior-execution";
import type { BackendExecutionResult, TeardownResult } from "../../src/sandbox/types";

const inputDigest = "sha256:" + "a".repeat(64);
const outputDigest = "sha256:" + "b".repeat(64);

function makeSpec(): RunSpec {
  return {
    fixtureId: "replay-basic",
    fixtureRoot: "/tmp/fixture",
    stagedWorkspace: "/tmp/stage",
    skillPath: "/tmp/fixture/skill",
    agent: "codex",
    runId: "run-1",
    backend: "replay",
    limits: { timeoutMs: 30_000, memoryMb: 512, cpuLimit: 1, pidsLimit: 64 },
    network: { mode: "deny", allowedHosts: [] },
    allowedEnvironmentNames: [],
    invariants: {
      allowedWrites: ["workspace/review.md", "workspace/.skillsync/**"],
      requiredOutputs: ["workspace/review.md"],
      forbiddenPaths: ["/Users/**", "workspace/.secrets/**"],
      allowedTools: ["fs.read", "fs.write"],
    },
    inputDigest,
  };
}

function passingEvents(): RunnerEvent[] {
  const lines = [
    {
      protocol: "skillsync.runner.v1",
      runId: "run-1",
      seq: 0,
      atMs: 0,
      type: "run.started",
      payload: { agent: "codex", skillPath: "skill", inputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: "run-1",
      seq: 1,
      atMs: 1,
      type: "fs.write",
      payload: { path: "workspace/review.md", bytes: 12, digest: outputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: "run-1",
      seq: 2,
      atMs: 2,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    },
  ];
  return parseRunnerTrace(lines.map((line) => JSON.stringify(line)).join("\n") + "\n", {
    runId: "run-1",
    inputDigest,
  }).events;
}

function result(events: RunnerEvent[], overrides: Partial<BackendExecutionResult> = {}): BackendExecutionResult {
  return {
    processExitCode: 0,
    timedOut: false,
    protocolComplete: true,
    finalFiles: [{ path: "workspace/review.md", bytes: 12, digest: outputDigest }],
    eventDigest: computeEventDigest(events),
    finalFilesDigest: "sha256:" + "c".repeat(64),
    ...overrides,
  };
}

function findingCodes(value: ReturnType<typeof evaluateExecution>): string[] {
  return value.findings.map((finding) => finding.code);
}

describe("behavior execution invariants", () => {
  it("passes when the terminal event and virtual output satisfy the contract", () => {
    const events = passingEvents();
    const evaluation = evaluateExecution(makeSpec(), events, result(events));

    expect(evaluation.status).toBe("passed");
    expect(evaluation.findings).toEqual([]);
    expect(evaluation.evidence.writes).toHaveLength(1);
  });

  it("reports forbidden writes and missing required outputs", () => {
    const events = passingEvents();
    const forbidden = evaluateExecution(makeSpec(), events, result(events, {
      finalFiles: [{ path: "workspace/other.md", bytes: 1, digest: outputDigest }],
    }));
    const missing = evaluateExecution(makeSpec(), events, result(events, { finalFiles: [] }));

    expect(findingCodes(forbidden)).toEqual(expect.arrayContaining(["invariant.write-forbidden"]));
    expect(findingCodes(missing)).toEqual(expect.arrayContaining(["invariant.output-missing"]));
  });

  it("cross-checks Runner writes against the physical staged workspace delta", () => {
    const events = passingEvents();
    const matching = evaluateExecution(makeSpec(), events, result(events, {
      workspaceChanges: [{ path: "workspace/review.md", bytes: 12, digest: outputDigest }],
    }));
    const mismatched = evaluateExecution(makeSpec(), events, result(events, {
      workspaceChanges: [{ path: "workspace/review.md", bytes: 99, digest: "sha256:" + "d".repeat(64) }],
    }));
    const undeclared = evaluateExecution(makeSpec(), events, result(events, {
      workspaceChanges: [{ path: "workspace/other.md", bytes: 1, digest: outputDigest }],
    }));

    expect(findingCodes(matching)).not.toContain("invariant.workspace-evidence-mismatch");
    expect(findingCodes(mismatched)).toContain("invariant.workspace-evidence-mismatch");
    expect(findingCodes(undeclared)).toContain("invariant.workspace-evidence-mismatch");
  });

  it("reports undeclared tools, network attempts, and process spawns", () => {
    const events = passingEvents();
    const undeclaredTool = {
      protocol: "skillsync.runner.v1",
      runId: "run-1",
      seq: 3,
      atMs: 3,
      type: "tool.call",
      payload: { tool: "shell.exec", operation: "start", callId: "shell" },
    } as const;
    const network = {
      protocol: "skillsync.runner.v1",
      runId: "run-1",
      seq: 4,
      atMs: 4,
      type: "network.request",
      payload: { host: "example.com", port: 443, protocol: "https", decision: "blocked" },
    } as const;
    const process = {
      protocol: "skillsync.runner.v1",
      runId: "run-1",
      seq: 5,
      atMs: 5,
      type: "process.spawn",
      payload: { executable: "sh", argv: ["-c", "echo"], decision: "blocked" },
    } as const;

    const evaluation = evaluateExecution(makeSpec(), [...events, undeclaredTool, network, process], result(events));

    expect(findingCodes(evaluation)).toEqual(expect.arrayContaining([
      "invariant.tool-forbidden",
      "invariant.network-forbidden",
      "invariant.process-forbidden",
    ]));
  });

  it("fails on timeout, incomplete protocol, runner failure, or teardown failure", () => {
    const events = passingEvents();
    const timeout = evaluateExecution(makeSpec(), events, result(events, { timedOut: true }));
    const incomplete = evaluateExecution(makeSpec(), events, result(events, { protocolComplete: false }));
    const runnerFailure = evaluateExecution(makeSpec(), events.map((event) =>
      event.type === "run.finished"
        ? { ...event, payload: { ...event.payload, status: "failed" as const, exitCode: 1 } }
        : event,
    ), result(events, { processExitCode: 1 }));
    const teardown: TeardownResult = { completed: false, resourceId: "run-1", errorCode: "cleanup-failed" };
    const cleanupFailure = evaluateExecution(makeSpec(), events, result(events), teardown);

    expect(findingCodes(timeout)).toContain("execution.timeout");
    expect(findingCodes(incomplete)).toContain("runner.protocol-invalid");
    expect(findingCodes(runnerFailure)).toContain("execution.runner-failed");
    expect(findingCodes(cleanupFailure)).toContain("sandbox.teardown-failed");
  });
});
