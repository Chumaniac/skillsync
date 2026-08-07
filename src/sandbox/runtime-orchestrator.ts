import { createHash } from "node:crypto";

import {
  computeEventDigest,
  type RunnerEvent,
} from "../domain/runner-events.js";
import {
  activateRuntimeCapability,
  type RuntimeActivationBoundary,
} from "./runtime-activation-boundary.js";
import type { RuntimeCapabilityGateInput, RuntimeCapabilityFinding } from "./runtime-capability-gate.js";
import {
  parseProviderRunResult,
  type DeepReadonly,
  type ProviderAdapterPort,
  type ProviderRunRequest,
  type ProviderRunResult,
  type RuntimeExecutionResult,
} from "./runtime-ports.js";

export type RuntimeOrchestratorRequest = DeepReadonly<{
  providerRequest: ProviderRunRequest;
  activationInput: RuntimeCapabilityGateInput;
  signal?: AbortSignal;
}>;

export type RuntimeOrchestratorPorts = Readonly<{
  simulatedProvider: ProviderAdapterPort;
  liveProvider: ProviderAdapterPort;
}>;

const idleSignal = new AbortController().signal;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function boundedSimulationResult(request: ProviderRunRequest, reason: string): ProviderRunResult {
  const events: readonly RunnerEvent[] = [];
  return {
    events,
    terminalStatus: "blocked",
    eventDigest: computeEventDigest(events),
    redactedEvidenceDigest: digest({
      schemaVersion: 1,
      evidenceMode: "offline-simulated",
      terminalStatus: "blocked",
      resourceId: request.runId,
      reason,
    }),
    teardown: { completed: true, resourceId: request.runId },
    evidenceMode: "offline-simulated",
  };
}

function blockedExecution(finding: RuntimeCapabilityFinding): RuntimeExecutionResult {
  return {
    status: "blocked",
    evidenceMode: "offline-simulated",
    finding,
  };
}

function invalidLiveResult(): RuntimeExecutionResult {
  return blockedExecution({
    code: "runtime.activation-input-invalid",
    status: "fail",
    message: "Live runtime evidence was invalid, unbounded, or used the offline evidence mode.",
  });
}

export async function runSimulatedRuntime(
  request: RuntimeOrchestratorRequest,
  ports: RuntimeOrchestratorPorts,
): Promise<ProviderRunResult> {
  let result: ProviderRunResult;
  try {
    result = await ports.simulatedProvider.run(
      request.providerRequest,
      request.signal ?? idleSignal,
    );
  } catch {
    return boundedSimulationResult(request.providerRequest, "provider-run-failed");
  }
  const bounded = parseProviderRunResult(result as unknown);
  if (bounded === null) {
    return boundedSimulationResult(request.providerRequest, "provider-result-invalid");
  }
  if (bounded.evidenceMode !== "offline-simulated") {
    return boundedSimulationResult(request.providerRequest, "provider-result-not-offline");
  }
  return bounded;
}

export async function runLiveRuntime(
  request: RuntimeOrchestratorRequest,
  ports: RuntimeOrchestratorPorts,
  boundary: RuntimeActivationBoundary | null | undefined,
): Promise<RuntimeExecutionResult> {
  let activation: Awaited<ReturnType<typeof activateRuntimeCapability<ProviderRunResult>>>;
  try {
    activation = await activateRuntimeCapability(
      boundary,
      request.activationInput,
      () => ports.liveProvider.run(request.providerRequest, request.signal ?? idleSignal),
    );
  } catch {
    return invalidLiveResult();
  }
  if (activation.finding.status === "fail" || activation.result === undefined) {
    return blockedExecution(activation.finding);
  }

  const bounded = parseProviderRunResult(activation.result as unknown);
  if (bounded === null || bounded.evidenceMode === "offline-simulated") {
    return invalidLiveResult();
  }

  return {
    status: bounded.terminalStatus,
    evidenceMode: bounded.evidenceMode,
    result: bounded,
  };
}
