import { z } from "zod";

import type { RunSpec } from "../domain/behavior-v2.js";
import { RUNNER_EVENT_LIMITS, RunnerEventSchema, type RunnerEvent } from "../domain/runner-events.js";
import type { RuntimeCapabilityFinding } from "./runtime-capability-gate.js";
import {
  normalizeEgressHost,
  type EgressPolicy,
  type EgressProxyDecision,
  type EgressRequest,
} from "./egress-contract.js";
import type { RemoteLifecycleEvent } from "./remote-contract.js";
import { normalizeRuntimeEvidenceMode, type RuntimeEvidenceMode } from "./runtime-evidence.js";
import type {
  BackendAvailability,
  BackendExecutionResult,
  SandboxHandle,
  TeardownResult,
} from "./types.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const RunIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const AttemptSchema = z.number().int().min(1).max(16);
const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(64);
const ResourceIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const ExternalReferenceSchema = z.string()
  .regex(/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._~:/-]+$/)
  .max(256)
  .refine((value) => !/(^|\/)\.\.?($|\/)/.test(value), "reference path must not contain dot segments");
const RuntimeCapabilityFindingSchema = z.union([
  z.object({
    code: z.enum(["runtime.activation-approved", "runtime.activation-already-recorded"]),
    status: z.literal("pass"),
    message: z.string().min(1).max(512),
  }).strict(),
  z.object({
    code: z.enum([
      "runtime.activation-input-invalid",
      "runtime.attestation-invalid",
      "runtime.activation-order",
      "runtime.artifact-missing",
    ]),
    status: z.literal("fail"),
    message: z.string().min(1).max(512),
  }).strict(),
]);
const RuntimeEvidenceModeValueSchema = z.custom<RuntimeEvidenceMode>(
  (value): value is RuntimeEvidenceMode => normalizeRuntimeEvidenceMode(value) !== null,
  { message: "invalid evidence mode" },
).transform((value) => normalizeRuntimeEvidenceMode(value) as RuntimeEvidenceMode);

const NormalizedCredentialContractSchema = z.object({
  schemaVersion: z.literal(1),
  adapterId: IdentifierSchema,
  provider: IdentifierSchema,
  credentials: z.array(z.object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
    reference: ExternalReferenceSchema.refine((value) => value.startsWith("secret://"), {
      message: "credential references must use secret://",
    }),
    scopes: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/)).min(1).max(16),
    maxTtlSeconds: z.number().int().positive().max(3_600),
    revocation: z.literal("required"),
  }).strict()).max(16).superRefine((values, context) => {
    const names = values.map((value) => value.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "credential names must be unique" });
    }
  }),
}).strict();

const EgressPolicySchema = z.object({
  mode: z.enum(["deny", "allowlist"]),
  allowedHosts: z.array(z.string()).max(64),
}).strict().transform((value) => ({
  mode: value.mode,
  allowedHosts: value.allowedHosts.map(normalizeEgressHost),
} satisfies EgressPolicy));

const EgressRequestSchema = z.object({
  requestId: RunIdSchema,
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  protocol: z.enum(["http", "https", "dns"]),
}).strict().transform((value) => ({
  requestId: value.requestId,
  host: normalizeEgressHost(value.host),
  port: value.port,
  protocol: value.protocol,
} satisfies EgressRequest));

const EgressProxyDecisionSchema = z.object({
  requestId: RunIdSchema,
  requestedHost: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  protocol: z.enum(["http", "https", "dns"]),
  decision: z.enum(["allowed", "blocked"]),
  enforcement: z.literal("proxy"),
  proxyStatus: z.enum(["available", "unavailable"]),
  resolvedAddresses: z.array(z.string().min(1).max(45)).max(8),
  redirectChain: z.array(z.string().min(1).max(253)).max(16),
}).strict().transform((value) => ({
  requestId: value.requestId,
  requestedHost: normalizeEgressHost(value.requestedHost),
  port: value.port,
  protocol: value.protocol,
  decision: value.decision,
  enforcement: value.enforcement,
  proxyStatus: value.proxyStatus,
  resolvedAddresses: [...value.resolvedAddresses],
  redirectChain: value.redirectChain.map(normalizeEgressHost),
} satisfies EgressProxyDecision));

const ProviderRunRequestSchema = z.object({
  runId: RunIdSchema,
  attempt: AttemptSchema,
  skillDigest: DigestSchema,
  inputDigest: DigestSchema,
  policyDigest: DigestSchema,
  imageDigest: DigestSchema,
  adapterId: IdentifierSchema,
  adapterVersion: VersionSchema,
  provider: IdentifierSchema,
  providerVersion: VersionSchema,
  credentialContract: NormalizedCredentialContractSchema,
  egressPolicy: EgressPolicySchema,
  timeoutMs: z.number().int().positive().max(600_000),
  maxOutputBytes: z.number().int().positive().max(RUNNER_EVENT_LIMITS.maxTotalBytes),
}).strict();

const ProviderRunResultSchema = z.object({
  events: z.array(RunnerEventSchema).max(RUNNER_EVENT_LIMITS.maxEvents),
  terminalStatus: z.enum(["passed", "failed", "blocked"]),
  eventDigest: DigestSchema,
  redactedEvidenceDigest: DigestSchema,
  teardown: z.object({
    completed: z.boolean(),
    resourceId: ResourceIdSchema,
    errorCode: z.string().min(1).max(128).optional(),
  }).strict(),
  evidenceMode: RuntimeEvidenceModeValueSchema,
}).strict().transform((value) => ({
  events: [...value.events],
  terminalStatus: value.terminalStatus,
  eventDigest: value.eventDigest,
  redactedEvidenceDigest: value.redactedEvidenceDigest,
  teardown: { ...value.teardown },
  evidenceMode: value.evidenceMode,
} satisfies ProviderRunResultShape));

const RemoteRunRequestSchema = z.object({
  runId: RunIdSchema,
  attempt: AttemptSchema,
  resourceId: ResourceIdSchema,
  skillDigest: DigestSchema,
  inputDigest: DigestSchema,
  policyDigest: DigestSchema,
  imageDigest: DigestSchema,
  credentialContractReference: ExternalReferenceSchema.refine((value) => value.startsWith("secret://"), {
    message: "credential references must use secret://",
  }),
  egressPolicyReference: ExternalReferenceSchema,
}).strict();

const RemoteResourceSchema = z.object({
  resourceId: ResourceIdSchema,
  runId: RunIdSchema,
  attempt: AttemptSchema,
}).strict();

const RuntimeExecutionResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked"]),
  evidenceMode: RuntimeEvidenceModeValueSchema,
  result: ProviderRunResultSchema.optional(),
  finding: RuntimeCapabilityFindingSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.result === undefined && value.finding === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runtime execution result requires a provider result or capability finding",
    });
  }
  if (value.result !== undefined && value.result.evidenceMode !== value.evidenceMode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runtime execution result evidenceMode must match the nested provider result evidenceMode",
      path: ["evidenceMode"],
    });
  }
}).transform((value) => ({
  status: value.status,
  evidenceMode: value.evidenceMode,
  ...(value.result !== undefined ? { result: value.result } : {}),
  ...(value.finding !== undefined ? { finding: value.finding as RuntimeCapabilityFinding } : {}),
} satisfies RuntimeExecutionResultShape));

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
    return value;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T | null {
  try {
    const result = schema.safeParse(input);
    return result.success ? deepFreeze(result.data) : null;
  } catch {
    return null;
  }
}

export type Digest = z.infer<typeof DigestSchema>;
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

type ProviderRunResultShape = {
  events: readonly RunnerEvent[];
  terminalStatus: "passed" | "failed" | "blocked";
  eventDigest: Digest;
  redactedEvidenceDigest: Digest;
  teardown: TeardownResult;
  evidenceMode: RuntimeEvidenceMode;
};

type RuntimeExecutionResultShape = {
  status: "passed" | "failed" | "blocked";
  evidenceMode: RuntimeEvidenceMode;
  result?: ProviderRunResult;
  finding?: RuntimeCapabilityFinding;
};

export type ProviderRunRequest = DeepReadonly<z.infer<typeof ProviderRunRequestSchema>>;
export type ProviderRunResult = DeepReadonly<ProviderRunResultShape>;
export type RemoteRunRequest = DeepReadonly<z.infer<typeof RemoteRunRequestSchema>>;
export type RemoteResource = DeepReadonly<z.infer<typeof RemoteResourceSchema>>;
export type RuntimeExecutionResult = DeepReadonly<RuntimeExecutionResultShape>;

export interface ProviderAdapterPort {
  run(request: ProviderRunRequest, signal: AbortSignal): Promise<ProviderRunResult>;
}

export interface EgressPort {
  decide(request: EgressRequest, policy: EgressPolicy): Promise<EgressProxyDecision>;
}

export interface MicrovmPort {
  checkAvailable(request: RunSpec): Promise<BackendAvailability>;
  provision(request: RunSpec): Promise<SandboxHandle>;
  execute(
    handle: SandboxHandle,
    request: RunSpec,
    onEvent: (event: RunnerEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<BackendExecutionResult>;
  teardown(handle: SandboxHandle): Promise<TeardownResult>;
}

export interface RemoteWorkerPort {
  provision(request: RemoteRunRequest): Promise<RemoteResource>;
  execute(resource: RemoteResource, request: RemoteRunRequest, signal: AbortSignal): Promise<RemoteLifecycleEvent[]>;
  teardown(resource: RemoteResource): Promise<RemoteLifecycleEvent>;
}

export {
  EgressPolicySchema as RuntimePortEgressPolicySchema,
  EgressProxyDecisionSchema as RuntimePortEgressProxyDecisionSchema,
  EgressRequestSchema as RuntimePortEgressRequestSchema,
  ProviderRunRequestSchema,
  ProviderRunResultSchema,
  RemoteResourceSchema,
  RemoteRunRequestSchema,
  RuntimeCapabilityFindingSchema,
  RuntimeExecutionResultSchema,
};

export function parseProviderRunRequest(input: unknown): ProviderRunRequest | null {
  return parseWithSchema(ProviderRunRequestSchema, input);
}

export function parseProviderRunResult(input: unknown): ProviderRunResult | null {
  return parseWithSchema(ProviderRunResultSchema, input);
}

export function parseRemoteRunRequest(input: unknown): RemoteRunRequest | null {
  return parseWithSchema(RemoteRunRequestSchema, input);
}

export function parseRemoteResource(input: unknown): RemoteResource | null {
  return parseWithSchema(RemoteResourceSchema, input);
}

export function parseRuntimeExecutionResult(input: unknown): RuntimeExecutionResult | null {
  return parseWithSchema(RuntimeExecutionResultSchema, input);
}
