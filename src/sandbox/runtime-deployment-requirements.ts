import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const DeploymentKeyStoreReferenceSchema = z.string()
  .regex(/^deployment-key-store:\/\/[A-Za-z0-9._~:/-]+$/)
  .max(256)
  .refine((value) => !/(^|\/)\.\.?($|\/)/.test(value), "reference path must not contain dot segments");
const IdentityReferenceSchema = z.string()
  .regex(/^(?:deployment-key-store|mtls):\/\/[A-Za-z0-9._~:/-]+$/)
  .max(256)
  .refine((value) => !/(^|\/)\.\.?($|\/)/.test(value), "reference path must not contain dot segments");

const RuntimeDeploymentCapabilities = [
  "egress",
  "provider-credentials",
  "docker-microvm",
  "remote-worker",
] as const;

const RollbackTriggerSchema = z.enum([
  "receipt-missing",
  "credential-leak",
  "network-policy-regression",
  "teardown-incomplete",
  "untrusted-artifact",
]);

const RollbackSchema = z.object({
  enabled: z.literal(true),
  target: z.literal("existing-fail-closed-backend"),
  triggers: z.array(RollbackTriggerSchema).min(1).max(16).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "rollback triggers must be unique" });
    }
  }),
}).strict();

const EntrypointSchema = z.object({
  boundary: z.literal("runtime-activation-boundary"),
  enforcement: z.literal("required"),
  implementation: z.literal("not-enabled"),
}).strict();

const WorkerIdentitySchema = z.object({
  source: z.enum(["deployment-key-store", "mtls"]),
  reference: IdentityReferenceSchema,
}).strict().superRefine((value, context) => {
  const expectedPrefix = value.source === "mtls" ? "mtls://" : "deployment-key-store://";
  if (!value.reference.startsWith(expectedPrefix)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "worker identity source and reference scheme must match",
      path: ["reference"],
    });
  }
});

export const RuntimeDeploymentRequirementsSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("deployment-config"),
  liveCapabilitiesEnabled: z.literal(false),
  activation: z.object({
    order: z.tuple([
      z.literal("egress"),
      z.literal("provider-credentials"),
      z.literal("docker-microvm"),
      z.literal("remote-worker"),
    ]),
    rootPin: z.object({
      reference: DeploymentKeyStoreReferenceSchema,
      keyId: IdentifierSchema,
      fingerprint: DigestSchema,
    }).strict(),
    entrypoints: z.object({
      egress: EntrypointSchema,
      "provider-credentials": EntrypointSchema,
      "docker-microvm": EntrypointSchema,
      "remote-worker": EntrypointSchema,
    }).strict(),
  }).strict(),
  worker: z.object({
    mode: z.literal("secure"),
    identity: WorkerIdentitySchema,
    receipt: z.object({
      required: z.literal(true),
      maxTtlSeconds: z.literal(3600),
      cleanupRequired: z.literal(true),
    }).strict(),
  }).strict(),
  controlledEnvironment: z.object({
    runner: z.literal("controlled-ci"),
    network: z.literal("isolated"),
    egress: z.literal("deny-by-default"),
    credentials: z.literal("external-reference-only"),
    hostMounts: z.literal("none"),
    docker: z.object({
      daemon: z.literal("controlled-ci-only"),
      baseImages: z.literal("preseeded-only"),
      pull: z.literal("forbidden"),
      socketMount: z.literal("forbidden"),
      network: z.literal("deny"),
    }).strict(),
    microvm: z.object({
      execution: z.literal("controlled-ci-only"),
      network: z.literal("deny-by-default"),
      hostMounts: z.literal("forbidden"),
    }).strict(),
    publicEvidence: z.literal("bounded-redacted"),
  }).strict(),
  rollback: RollbackSchema,
}).strict();

export type RuntimeDeploymentRequirements = z.infer<typeof RuntimeDeploymentRequirementsSchema>;

export type RuntimeDeploymentRequirementsFinding =
  | {
      code: "runtime.deployment-requirements-declared";
      status: "pass";
      authoritative: false;
      reasons: [];
    }
  | {
      code: "runtime.deployment-requirements-blocked";
      status: "fail";
      authoritative: false;
      reasons: string[];
    };

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function parseValue(input: unknown): RuntimeDeploymentRequirements | null {
  const result = RuntimeDeploymentRequirementsSchema.safeParse(input);
  return result.success ? deepFreeze(result.data) : null;
}

export function parseRuntimeDeploymentRequirements(
  input: unknown,
): RuntimeDeploymentRequirements | null {
  return parseValue(input);
}

export function parseRuntimeDeploymentRequirementsFile(
  content: string,
): RuntimeDeploymentRequirements | null {
  if (Buffer.byteLength(content, "utf8") > 32 * 1024) {
    return null;
  }
  try {
    return parseValue(JSON.parse(content) as unknown);
  } catch {
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalidReasons(input: unknown): string[] {
  const root = objectRecord(input);
  if (root?.liveCapabilitiesEnabled === true) {
    return ["live-capabilities-enabled"];
  }
  const worker = objectRecord(root?.worker);
  if (worker?.mode !== undefined && worker.mode !== "secure") {
    return ["worker-mode-not-secure"];
  }
  const environment = objectRecord(root?.controlledEnvironment);
  if (environment?.network !== undefined && environment.network !== "isolated") {
    return ["controlled-environment-unisolated"];
  }
  if (environment?.hostMounts !== undefined && environment.hostMounts !== "none") {
    return ["host-mounts-not-empty"];
  }
  return ["requirements-input-invalid"];
}

export function evaluateRuntimeDeploymentRequirements(
  input: unknown,
): RuntimeDeploymentRequirementsFinding {
  return parseValue(input) === null
    ? {
        code: "runtime.deployment-requirements-blocked",
        status: "fail",
        authoritative: false,
        reasons: invalidReasons(input),
      }
    : {
        code: "runtime.deployment-requirements-declared",
        status: "pass",
        authoritative: false,
        reasons: [],
      };
}

export const RUNTIME_DEPLOYMENT_CAPABILITIES = RuntimeDeploymentCapabilities;
