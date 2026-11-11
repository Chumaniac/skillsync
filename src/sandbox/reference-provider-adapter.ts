import { createHash } from "node:crypto";

import {
  computeEventDigest,
  parseRunnerTrace,
  summarizeRunnerEvents,
  type RunnerEvent,
  type TraceValidationResult,
} from "../domain/runner-events.js";
import {
  parseProviderRunRequest,
  type ProviderAdapterPort,
  type ProviderRunRequest,
  type ProviderRunResult,
} from "./runtime-ports.js";

const RUN_ID_MARKER = "__SKILLSYNC_RUN_ID__";
const INPUT_DIGEST_MARKER = "__SKILLSYNC_INPUT_DIGEST__";
const REFERENCE_EVENT_FIXTURE = [
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":0,"atMs":0,"type":"run.started","payload":{"agent":"reference-agent","skillPath":"skills/reference","inputDigest":"__SKILLSYNC_INPUT_DIGEST__"}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":1,"atMs":1,"type":"tool.call","payload":{"tool":"reference.simulated","operation":"start","callId":"reference-read"}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":2,"atMs":2,"type":"fs.read","payload":{"path":"workspace/input.md","bytes":24}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":3,"atMs":3,"type":"tool.call","payload":{"tool":"reference.simulated","operation":"finish","callId":"reference-read","result":"ok"}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":4,"atMs":4,"type":"tool.call","payload":{"tool":"reference.simulated","operation":"start","callId":"reference-write"}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":5,"atMs":5,"type":"fs.write","payload":{"path":"workspace/reference-output.md","bytes":16,"digest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":6,"atMs":6,"type":"tool.call","payload":{"tool":"reference.simulated","operation":"finish","callId":"reference-write","result":"ok"}}',
  '{"protocol":"skillsync.runner.v1","runId":"__SKILLSYNC_RUN_ID__","seq":7,"atMs":7,"type":"run.finished","payload":{"status":"passed","exitCode":0}}',
].join("\n") + "\n";

const REFERENCE_BINDING = {
  skillDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  policyDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  adapterId: "reference",
  adapterVersion: "1.0.0",
  provider: "reference-agent",
  providerVersion: "0.1.0",
} as const;

export type ReferenceProviderAdapterErrorCode =
  | "provider.request-invalid"
  | "provider.identity-mismatch"
  | "provider.digest-mismatch"
  | "provider.event-invalid"
  | "provider.output-too-large";

export class ReferenceProviderAdapterError extends Error {
  readonly code: ReferenceProviderAdapterErrorCode;

  constructor(code: ReferenceProviderAdapterErrorCode) {
    super(`${code}: reference provider adapter request or fixture is invalid`);
    this.name = "ReferenceProviderAdapterError";
    this.code = code;
  }
}

function stableDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizeRequest(request: ProviderRunRequest): ProviderRunRequest {
  const parsed = parseProviderRunRequest(request as unknown);
  if (parsed === null) {
    throw new ReferenceProviderAdapterError("provider.request-invalid");
  }
  return parsed;
}

function verifyBinding(request: ProviderRunRequest): void {
  if (
    request.adapterId !== REFERENCE_BINDING.adapterId
    || request.adapterVersion !== REFERENCE_BINDING.adapterVersion
    || request.provider !== REFERENCE_BINDING.provider
    || request.providerVersion !== REFERENCE_BINDING.providerVersion
  ) {
    throw new ReferenceProviderAdapterError("provider.identity-mismatch");
  }
  if (
    request.skillDigest !== REFERENCE_BINDING.skillDigest
    || request.policyDigest !== REFERENCE_BINDING.policyDigest
    || request.imageDigest !== REFERENCE_BINDING.imageDigest
  ) {
    throw new ReferenceProviderAdapterError("provider.digest-mismatch");
  }
}

function bindFixture(content: string, request: ProviderRunRequest): string {
  return content
    .replaceAll(RUN_ID_MARKER, request.runId)
    .replaceAll(INPUT_DIGEST_MARKER, request.inputDigest);
}

export function parseReferenceProviderEvents(
  content: string,
  request: ProviderRunRequest,
): TraceValidationResult {
  const normalized = normalizeRequest(request);
  verifyBinding(normalized);
  try {
    return parseRunnerTrace(bindFixture(content, normalized), {
      runId: normalized.runId,
      inputDigest: normalized.inputDigest,
    });
  } catch {
    throw new ReferenceProviderAdapterError("provider.event-invalid");
  }
}

function resultFor(
  request: ProviderRunRequest,
  events: readonly RunnerEvent[],
  terminalStatus: ProviderRunResult["terminalStatus"],
): ProviderRunResult {
  const evidence = summarizeRunnerEvents(events);
  return {
    events: [...events],
    terminalStatus,
    eventDigest: computeEventDigest(events),
    redactedEvidenceDigest: stableDigest(JSON.stringify(evidence)),
    teardown: { completed: true, resourceId: request.runId },
    evidenceMode: "offline-simulated",
  };
}

function createAdapter(): ProviderAdapterPort {
  return {
    async run(request: ProviderRunRequest, signal: AbortSignal): Promise<ProviderRunResult> {
      const normalized = normalizeRequest(request);
      verifyBinding(normalized);

      if (signal.aborted) {
        return resultFor(normalized, [], "blocked");
      }

      const boundFixture = bindFixture(REFERENCE_EVENT_FIXTURE, normalized);
      if (Buffer.byteLength(boundFixture, "utf8") > normalized.maxOutputBytes) {
        throw new ReferenceProviderAdapterError("provider.output-too-large");
      }

      const parsed = parseReferenceProviderEvents(boundFixture, normalized);
      const emitted: RunnerEvent[] = [];
      for (const event of parsed.events) {
        if (signal.aborted) {
          return resultFor(normalized, emitted, "blocked");
        }
        emitted.push(event);
        await new Promise<void>((complete) => complete());
        if (signal.aborted) {
          return resultFor(normalized, emitted, "blocked");
        }
      }

      return resultFor(normalized, emitted, parsed.terminalStatus);
    },
  };
}

export function createReferenceProviderAdapter(): ProviderAdapterPort {
  return createAdapter();
}
