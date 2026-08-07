import { matchSandboxGlob } from "./behavior-v2.js";
import { summarizeRunnerEvents, type RunnerEvidence, type RunnerEvent } from "./runner-events.js";
import type { BackendExecutionResult, TeardownResult } from "../sandbox/types.js";
import type { RunSpec } from "./behavior-v2.js";

export type BehaviorFinding = {
  code: string;
  status: "pass" | "fail" | "not-run";
  message: string;
  evidence: Array<Record<string, string>>;
};

export type BehaviorExecutionEvidence = RunnerEvidence & {
  finalFiles: Array<{ path: string; bytes: number; digest: string }>;
  teardown: TeardownResult | null;
};

export type BehaviorExecutionReport = {
  schema_version: 2;
  fixture: {
    id: string;
    schema_version: 2;
    input_digest: string;
  };
  preflight: {
    status: "passed" | "failed";
    findings: BehaviorFinding[];
  };
  execution: {
    status: "not-run" | "passed" | "failed" | "blocked";
    backend: "replay" | "docker" | null;
    run_id: string | null;
    started_at: string | null;
    finished_at: string | null;
    staged_digest: string | null;
    event_digest: string | null;
    exit_code: 0 | 1 | 2 | 3 | 4;
    reason?: string;
    findings: BehaviorFinding[];
    evidence: {
      event_count: number;
      redacted: boolean;
      writes: Array<{ path: string; bytes: number; digest: string }>;
      tools: string[];
      network: Array<{ host: string; port: number; decision: string }>;
      teardown: { completed: boolean; resource_id: string } | null;
    };
  };
};

export type ExecutionEvaluation = {
  status: "passed" | "failed";
  findings: BehaviorFinding[];
  evidence: BehaviorExecutionEvidence;
};

function finding(
  code: string,
  message: string,
  evidence: Array<Record<string, string>> = [],
): BehaviorFinding {
  return { code, status: "fail", message, evidence };
}

function workspaceForbidden(path: string, patterns: readonly string[]): string | undefined {
  return patterns.find((pattern) => {
    if (pattern.startsWith("/")) {
      return false;
    }
    return matchSandboxGlob(path, pattern);
  });
}

function allowedWrite(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchSandboxGlob(path, pattern));
}

function terminalFailure(events: readonly RunnerEvent[]): boolean {
  const terminal = events.at(-1);
  return terminal?.type !== "run.finished" || terminal.payload.status !== "passed";
}

export function evaluateExecution(
  spec: RunSpec,
  events: readonly RunnerEvent[],
  result: BackendExecutionResult,
  teardown: TeardownResult = { completed: true, resourceId: spec.runId },
): ExecutionEvaluation {
  const findings: BehaviorFinding[] = [];
  const evidence = summarizeRunnerEvents(events);
  const finalFiles = [...result.finalFiles];
  const observedWrites = evidence.writes;
  const physicalChanges = result.workspaceChanges ?? [];
  const allWrites = [...observedWrites, ...finalFiles, ...physicalChanges];

  for (const write of allWrites) {
    const forbiddenPattern = workspaceForbidden(write.path, spec.invariants.forbiddenPaths);
    if (forbiddenPattern || !allowedWrite(write.path, spec.invariants.allowedWrites)) {
      findings.push(
        finding(
          "invariant.write-forbidden",
          `Write is outside the declared writable paths: ${write.path}`,
          [{ path: write.path, pattern: forbiddenPattern ?? "<none>" }],
        ),
      );
    }
  }

  for (const requiredOutput of spec.invariants.requiredOutputs) {
    if (!finalFiles.some((file) => file.path === requiredOutput)) {
      findings.push(
        finding(
          "invariant.output-missing",
          `Required output is missing: ${requiredOutput}`,
          [{ path: requiredOutput }],
        ),
      );
    }
  }

  if (result.workspaceChanges !== undefined || result.workspaceDeletedPaths !== undefined) {
    const runnerWrites = new Map(observedWrites.map((write) => [write.path, write]));
    const physicalWrites = new Map(physicalChanges.map((write) => [write.path, write]));
    for (const write of runnerWrites.values()) {
      const physical = physicalWrites.get(write.path);
      if (!physical || physical.bytes !== write.bytes || physical.digest !== write.digest) {
        findings.push(
          finding(
            "invariant.workspace-evidence-mismatch",
            `Runner write evidence does not match the staged workspace: ${write.path}`,
            [{ path: write.path }],
          ),
        );
      }
    }
    for (const write of physicalWrites.values()) {
      if (!runnerWrites.has(write.path)) {
        findings.push(
          finding(
            "invariant.workspace-evidence-mismatch",
            `Staged workspace changed without matching Runner evidence: ${write.path}`,
            [{ path: write.path }],
          ),
        );
      }
    }
    for (const path of result.workspaceDeletedPaths ?? []) {
      findings.push(
        finding(
          "invariant.workspace-evidence-mismatch",
          `Staged workspace file was deleted without matching Runner evidence: ${path}`,
          [{ path }],
        ),
      );
    }
  }

  const toolNames = new Set(
    events
      .filter((event): event is Extract<RunnerEvent, { type: "tool.call" }> => event.type === "tool.call")
      .map((event) => event.payload.tool),
  );
  for (const tool of toolNames) {
    if (!spec.invariants.allowedTools.includes(tool)) {
      findings.push(finding("invariant.tool-forbidden", `Tool is not declared: ${tool}`, [{ tool }]));
    }
  }

  for (const event of events) {
    if (event.type === "network.request") {
      const allowed = spec.network.mode === "allowlist" && spec.network.allowedHosts.includes(event.payload.host);
      if (spec.network.mode === "deny" || !allowed || event.payload.decision !== "allowed") {
        findings.push(
          finding(
            "invariant.network-forbidden",
            `Network request violated the declared policy: ${event.payload.host}`,
            [{ host: event.payload.host, port: String(event.payload.port), decision: event.payload.decision }],
          ),
        );
      }
    }
    if (event.type === "process.spawn") {
      findings.push(
        finding(
          "invariant.process-forbidden",
          `Process spawn is not allowed in behavior fixture v2: ${event.payload.executable}`,
          [{ executable: event.payload.executable }],
        ),
      );
    }
  }

  if (result.timedOut) {
    findings.push(finding("execution.timeout", "Sandbox execution exceeded its configured deadline."));
  }
  if (!result.protocolComplete) {
    findings.push(finding("runner.protocol-invalid", "Runner did not produce a complete protocol trace."));
  }
  if (terminalFailure(events) || result.processExitCode !== 0) {
    findings.push(finding("execution.runner-failed", "Runner reported a non-passing terminal result."));
  }
  if (!teardown.completed) {
    findings.push(
      finding(
        "sandbox.teardown-failed",
        "Sandbox resources were not cleaned up successfully.",
        [{ resource: teardown.resourceId, error: teardown.errorCode ?? "unknown" }],
      ),
    );
  }

  return {
    status: findings.length === 0 ? "passed" : "failed",
    findings,
    evidence: {
      ...evidence,
      finalFiles,
      teardown,
    },
  };
}
