import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const MicrovmContractSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceMode: z.literal("offline-simulated"),
  liveCapabilitiesEnabled: z.literal(false),
  runner: z.literal("controlled-ci"),
  mode: z.literal("isolated"),
  hostMounts: z.literal("none"),
  image: z.object({
    digest: DigestSchema,
    source: z.literal("preseeded"),
    preseeded: z.literal(true),
    immutable: z.literal(true),
  }).strict(),
  network: z.object({
    mode: z.literal("deny"),
    egress: z.literal("deny-by-default"),
  }).strict(),
  limits: z.object({
    cpuMs: z.number().int().positive().max(600_000),
    memoryBytes: z.number().int().positive().max(1_073_741_824),
    processCount: z.number().int().positive().max(512),
    outputBytes: z.number().int().positive().max(1_048_576),
    lifetimeMs: z.number().int().positive().max(600_000),
  }).strict(),
  teardown: z.object({
    required: z.literal(true),
    cleanupProof: z.literal("required"),
  }).strict(),
}).strict();

export type MicrovmContract = DeepReadonly<z.infer<typeof MicrovmContractSchema>>;

export type MicrovmFinding =
  | {
      code: "microvm.contract-valid";
      status: "pass";
      authoritative: false;
      reasons: [];
      message: "MicroVM contract is isolated, preseeded, network-denied, and cleanup-bound.";
    }
  | {
      code: "microvm.contract-invalid";
      status: "fail";
      authoritative: false;
      reasons: string[];
      message: "MicroVM contract is invalid or does not prove the required isolation boundary.";
    };

type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      deepFreeze(child);
    }
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function parseValue(input: unknown): MicrovmContract | null {
  try {
    const result = MicrovmContractSchema.safeParse(input);
    return result.success ? deepFreeze(result.data) : null;
  } catch {
    return null;
  }
}

export function parseMicrovmContract(input: unknown): MicrovmContract | null {
  return parseValue(input);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalidReasons(input: unknown): string[] {
  const root = record(input);
  if (root === null) {
    return ["contract-input-invalid"];
  }

  const reasons: string[] = [];
  if (root.liveCapabilitiesEnabled === true) {
    reasons.push("live-capabilities-enabled");
  }
  if (root.mode !== "isolated") {
    reasons.push("microvm-mode-not-isolated");
  }
  if (root.hostMounts !== "none") {
    reasons.push("host-mounts-not-empty");
  }

  const image = record(root.image);
  if (image?.source !== "preseeded" || image.preseeded !== true || image.immutable !== true) {
    reasons.push("image-not-preseeded");
  }

  const network = record(root.network);
  if (network?.mode !== "deny" || network.egress !== "deny-by-default") {
    reasons.push("network-not-deny-by-default");
  }

  const teardown = record(root.teardown);
  if (teardown?.required !== true) {
    reasons.push("teardown-required");
  }
  if (teardown?.cleanupProof !== "required") {
    reasons.push("cleanup-proof-required");
  }

  if (reasons.length === 0) {
    reasons.push("contract-input-invalid");
  }
  return [...new Set(reasons)];
}

export function evaluateMicrovmContract(input: unknown): MicrovmFinding {
  if (parseValue(input) !== null) {
    return {
      code: "microvm.contract-valid",
      status: "pass",
      authoritative: false,
      reasons: [],
      message: "MicroVM contract is isolated, preseeded, network-denied, and cleanup-bound.",
    };
  }
  return {
    code: "microvm.contract-invalid",
    status: "fail",
    authoritative: false,
    reasons: invalidReasons(input),
    message: "MicroVM contract is invalid or does not prove the required isolation boundary.",
  };
}

export { MicrovmContractSchema };
