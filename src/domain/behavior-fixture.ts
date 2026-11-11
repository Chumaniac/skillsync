import { parse } from "yaml";
import { z } from "zod";

import {
  BEHAVIOR_V2_LIMITS,
  matchSandboxGlob,
  normalizeSandboxPath,
} from "./behavior-v2.js";

const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const EnvironmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128);
const HostSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/).max(253);
const ImageSchema = z
  .string()
  .min(1)
  .refine((value) => /@sha256:[0-9a-f]{64}$/.test(value), "image must use an immutable sha256 digest");

export const BehaviorFixtureV1Schema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().min(1),
    description: z.string().min(1),
    skill_path: z.string().min(1).default("."),
    required_files: z.array(z.string().min(1)).default([]),
    forbidden_paths: z.array(z.string().min(1)).default([]),
  })
  .strict();

const BehaviorV2ExecutionSchema = z
  .object({
    backend: z.enum(["replay", "docker"]),
    replay_trace: z.string().min(1).optional(),
    image: ImageSchema.optional(),
    timeout_ms: z.number().int().positive().max(BEHAVIOR_V2_LIMITS.maxTimeoutMs),
    memory_mb: z.number().int().positive().max(BEHAVIOR_V2_LIMITS.maxMemoryMb),
    cpu_limit: z.number().positive().max(BEHAVIOR_V2_LIMITS.maxCpuLimit),
    pids_limit: z.number().int().positive().max(BEHAVIOR_V2_LIMITS.maxPidsLimit),
    network: z
      .object({
        mode: z.enum(["deny", "allowlist"]),
        allowed_hosts: z.array(HostSchema).max(32),
      })
      .strict(),
    environment: z
      .object({
        allow: z.array(EnvironmentNameSchema).max(32),
      })
      .strict(),
  })
  .strict()
  .superRefine((execution, context) => {
    if (execution.backend === "replay") {
      if (!execution.replay_trace) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["replay_trace"], message: "replay backend requires replay_trace" });
      }
      if (execution.image !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["image"], message: "replay backend must not define image" });
      }
    } else {
      if (!execution.image) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["image"], message: "docker backend requires image" });
      }
      if (execution.replay_trace !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["replay_trace"], message: "docker backend must not define replay_trace" });
      }
    }

    if (execution.network.mode === "deny" && execution.network.allowed_hosts.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["network", "allowed_hosts"], message: "deny network mode requires an empty host list" });
    }
    if (execution.network.mode === "allowlist" && execution.network.allowed_hosts.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["network", "allowed_hosts"], message: "allowlist network mode requires at least one host" });
    }
  });

const BehaviorV2InvariantsSchema = z
  .object({
    allowed_writes: z.array(z.string().min(1)).max(128),
    required_outputs: z.array(z.string().min(1)).max(128),
    forbidden_paths: z.array(z.string().min(1)).max(128),
    allowed_tools: z.array(z.string().min(1)).max(128),
  })
  .strict()
  .superRefine((invariants, context) => {
    const allowedWrites = validatePatterns(invariants.allowed_writes, "allowed_writes", context);
    const requiredOutputs = validatePatterns(invariants.required_outputs, "required_outputs", context);
    validatePatterns(invariants.forbidden_paths, "forbidden_paths", context, true);

    for (const output of requiredOutputs) {
      if (!allowedWrites.some((pattern) => matchSandboxGlob(output, pattern))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["required_outputs"], message: `required output is not writable: ${output}` });
      }
    }
  });

function validatePatterns(
  patterns: string[],
  label: string,
  context: z.RefinementCtx,
  sensitive = false,
): string[] {
  const normalized: string[] = [];
  patterns.forEach((pattern, index) => {
    try {
      normalized.push(normalizeSandboxPath(pattern, `${label}[${index}]`, sensitive ? "sensitive" : "workspace"));
    } catch (error: unknown) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [label, index],
        message: error instanceof Error ? error.message : `${label} contains an unsafe path`,
      });
    }
  });
  return normalized;
}

export const BehaviorFixtureV2Schema = z
  .object({
    schema_version: z.literal(2),
    id: IdentifierSchema,
    description: z.string().min(1).max(4_096),
    skill_path: z.string().min(1),
    agent: IdentifierSchema,
    execution: BehaviorV2ExecutionSchema,
    invariants: BehaviorV2InvariantsSchema,
  })
  .strict();

export type BehaviorFixtureV1 = z.infer<typeof BehaviorFixtureV1Schema>;
export type BehaviorFixtureV2 = z.infer<typeof BehaviorFixtureV2Schema>;
export type BehaviorFixture = BehaviorFixtureV1 | BehaviorFixtureV2;

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "Unknown error";
}

export function parseBehaviorManifest(content: string, manifestPath: string): BehaviorFixture {
  let value: unknown;
  try {
    value = parse(content, { uniqueKeys: true });
  } catch (error: unknown) {
    throw new Error(`Invalid behavior fixture ${manifestPath}: ${firstLine(error)}`);
  }

  const result = z.union([BehaviorFixtureV1Schema, BehaviorFixtureV2Schema]).safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid behavior fixture ${manifestPath}: ${issue?.message ?? "schema validation failed"}`);
  }
  return result.data;
}
