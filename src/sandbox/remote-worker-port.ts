import { createHash } from "node:crypto";

import { z } from "zod";

import type { Digest } from "./runtime-ports.js";
import {
  computeCleanupEvidenceDigest,
  parseRemoteLifecycleEvent,
  verifyRemoteLifecycleReceipt,
  type CleanupProof,
  type RemoteLifecycleEvent,
} from "./remote-contract.js";
import type {
  RemoteCompletionExpectation,
  RemoteReceiptFinding,
} from "./remote-receipt.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const IdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const AttemptSchema = z.number().int().min(1).max(16);

const RemoteRunRequestSchema = z.object({
  runId: IdentifierSchema,
  attempt: AttemptSchema,
  resourceId: IdentifierSchema,
  stagingDigest: DigestSchema,
  inputDigest: DigestSchema,
  imageDigest: DigestSchema,
  contextDigest: DigestSchema,
  mode: z.enum(["contract", "secure"]),
}).strict();

const RemoteResourceSchema = z.object({
  runId: IdentifierSchema,
  attempt: AttemptSchema,
  resourceId: IdentifierSchema,
  stagingDigest: DigestSchema,
}).strict();

type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type RemoteRunRequest = DeepReadonly<z.infer<typeof RemoteRunRequestSchema>>;
export type RemoteResource = DeepReadonly<z.infer<typeof RemoteResourceSchema>>;

export interface RemoteWorkerPort {
  provision(request: RemoteRunRequest): Promise<RemoteResource>;
  execute(resource: RemoteResource, request: RemoteRunRequest, signal: AbortSignal): Promise<RemoteLifecycleEvent[]>;
  teardown(resource: RemoteResource): Promise<RemoteLifecycleEvent>;
}

export class RemoteWorkerSimulatorError extends Error {
  readonly code = "remote.simulator-invalid" as const;

  constructor(message = "remote.simulator-invalid: remote contract evidence is invalid") {
    super(message);
    this.name = "RemoteWorkerSimulatorError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new RemoteWorkerSimulatorError();
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function digest(value: unknown): Digest {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function parseValue<T>(schema: z.ZodType<T>, input: unknown): T | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}

function normalizedRequest(input: unknown): RemoteRunRequest {
  const parsed = parseValue(RemoteRunRequestSchema, input);
  if (parsed === null) {
    throw new RemoteWorkerSimulatorError("remote.simulator-invalid: remote run request is invalid");
  }
  return parsed;
}

function normalizedResource(input: unknown): RemoteResource {
  const parsed = parseValue(RemoteResourceSchema, input);
  if (parsed === null) {
    throw new RemoteWorkerSimulatorError("remote.simulator-invalid: remote resource is invalid");
  }
  return parsed;
}

export function parseRemoteRunRequest(input: unknown): RemoteRunRequest | null {
  return parseValue(RemoteRunRequestSchema, input);
}

export function parseRemoteResource(input: unknown): RemoteResource | null {
  return parseValue(RemoteResourceSchema, input);
}

export function computeRemoteEventDigest(input: RemoteRunRequest): Digest {
  const request = normalizedRequest(input);
  return digest({
    schemaVersion: 1,
    evidenceMode: "offline-simulated",
    runId: request.runId,
    attempt: request.attempt,
    resourceId: request.resourceId,
    stagingDigest: request.stagingDigest,
    inputDigest: request.inputDigest,
    imageDigest: request.imageDigest,
    contextDigest: request.contextDigest,
    mode: request.mode,
  });
}

export function verifyRemoteWorkerSimulationReceipt(
  event: RemoteLifecycleEvent,
  receipt: unknown,
  expected: RemoteCompletionExpectation,
  trustedWorkerKeys: Readonly<Record<string, string>>,
  now = new Date(),
): RemoteReceiptFinding {
  return verifyRemoteLifecycleReceipt(event, receipt, expected, trustedWorkerKeys, now);
}

type SimulationState = {
  request: RemoteRunRequest;
  events?: RemoteLifecycleEvent[];
  teardown?: RemoteLifecycleEvent;
};

function resourceKey(resource: RemoteResource): string {
  return `${resource.runId}:${resource.attempt}:${resource.resourceId}`;
}

function sameRequest(left: RemoteRunRequest, right: RemoteRunRequest): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sameResource(request: RemoteRunRequest, resource: RemoteResource): boolean {
  return request.runId === resource.runId
    && request.attempt === resource.attempt
    && request.resourceId === resource.resourceId
    && request.stagingDigest === resource.stagingDigest;
}

function lifecycleEvent(runId: string, type: RemoteLifecycleEvent["type"], fields: Record<string, unknown> = {}): RemoteLifecycleEvent {
  return parseRemoteLifecycleEvent(JSON.stringify({ schema_version: 1, run_id: runId, type, ...fields }));
}

function cleanupEvent(request: RemoteRunRequest): RemoteLifecycleEvent {
  const body: Omit<CleanupProof, "evidence_digest"> = {
    attempt: request.attempt,
    run_id: request.runId,
    resource_id: request.resourceId,
    staging_digest: request.stagingDigest,
    event_digest: computeRemoteEventDigest(request),
    deleted: ["artifacts", "credentials", "logs", "workspace"],
  };
  const proof: CleanupProof = {
    ...body,
    evidence_digest: computeCleanupEvidenceDigest(body),
  };
  return lifecycleEvent(request.runId, "teardown.completed", { cleanup_proof: proof });
}

export function createRemoteWorkerSimulator(): RemoteWorkerPort {
  const states = new Map<string, SimulationState>();

  return {
    async provision(input: RemoteRunRequest): Promise<RemoteResource> {
      const request = normalizedRequest(input);
      const resource: RemoteResource = Object.freeze({
        runId: request.runId,
        attempt: request.attempt,
        resourceId: request.resourceId,
        stagingDigest: request.stagingDigest,
      });
      const key = resourceKey(resource);
      const existing = states.get(key);
      if (existing !== undefined && !sameRequest(existing.request, request)) {
        throw new RemoteWorkerSimulatorError("remote.simulator-invalid: resource is already bound to another digest set");
      }
      if (existing === undefined) {
        states.set(key, { request });
      }
      return resource;
    },

    async execute(inputResource: RemoteResource, inputRequest: RemoteRunRequest, signal: AbortSignal): Promise<RemoteLifecycleEvent[]> {
      const resource = normalizedResource(inputResource);
      const request = normalizedRequest(inputRequest);
      if (!sameResource(request, resource)) {
        throw new RemoteWorkerSimulatorError("remote.simulator-invalid: resource is not bound to the request");
      }
      const state = states.get(resourceKey(resource));
      if (state === undefined || !sameRequest(state.request, request)) {
        throw new RemoteWorkerSimulatorError("remote.simulator-invalid: request has no matching provisioned resource");
      }
      if (state.events !== undefined) {
        return [...state.events];
      }

      const events = [
        lifecycleEvent(request.runId, "run.created"),
        lifecycleEvent(request.runId, "workspace.staged", { staging_digest: request.stagingDigest }),
        lifecycleEvent(request.runId, "run.started"),
        ...(signal.aborted
          ? [lifecycleEvent(request.runId, "cancel.requested")]
          : [lifecycleEvent(request.runId, "run.finished", {
              status: "passed",
              exit_code: 0,
              event_digest: computeRemoteEventDigest(request),
            })]),
        lifecycleEvent(request.runId, "teardown.started"),
      ];
      state.events = events;
      return [...events];
    },

    async teardown(inputResource: RemoteResource): Promise<RemoteLifecycleEvent> {
      const resource = normalizedResource(inputResource);
      const state = states.get(resourceKey(resource));
      if (state === undefined || state.events === undefined) {
        throw new RemoteWorkerSimulatorError("remote.simulator-invalid: teardown requires an executed resource");
      }
      if (state.teardown !== undefined) {
        return state.teardown;
      }
      state.teardown = cleanupEvent(state.request);
      return state.teardown;
    },
  };
}

export { RemoteResourceSchema, RemoteRunRequestSchema };
