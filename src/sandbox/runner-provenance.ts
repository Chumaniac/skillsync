import { z } from "zod";

const MAX_PROVENANCE_BYTES = 64 * 1024;
const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const SignatureSchema = z
  .object({
    scheme: z.string().min(1).max(64),
    reference: z.string().min(1).max(512),
  })
  .strict();

const ProvenanceSchema = z
  .object({
    schema_version: z.literal(1),
    image_digest: DigestSchema,
    runner_protocol: z.literal("skillsync.runner.v1"),
    runner_contract: z.literal("1"),
    builder: z.string().min(1).max(256),
    source: z.string().min(1).max(512),
    signature: SignatureSchema.optional(),
  })
  .strict();

export type RunnerProvenance = {
  schemaVersion: 1;
  imageDigest: string;
  runnerProtocol: "skillsync.runner.v1";
  runnerContract: "1";
  builder: string;
  source: string;
  signature?: { scheme: string; reference: string };
};

export class RunnerProvenanceError extends Error {
  readonly code = "runner.provenance-invalid" as const;

  constructor() {
    super("runner.provenance-invalid: Runner provenance is invalid");
    this.name = "RunnerProvenanceError";
  }
}

export type RunnerProvenancePolicy = {
  imageDigest: string;
  runnerProtocol: "skillsync.runner.v1";
  runnerContract: "1";
  trustedBuilders?: string[];
  trustedSources?: string[];
  requireSignature?: boolean;
};

export type RunnerProvenanceFinding =
  | {
      code: "runner.provenance-valid";
      status: "pass";
      message: "Runner provenance matches the local policy.";
    }
  | {
      code:
        | "runner.provenance-digest-mismatch"
        | "runner.provenance-protocol-mismatch"
        | "runner.provenance-contract-mismatch"
        | "runner.provenance-untrusted-builder"
        | "runner.provenance-untrusted-source"
        | "runner.signature-verification-unavailable";
      status: "fail";
      message: string;
    };

export function parseRunnerProvenance(content: string): RunnerProvenance {
  if (Buffer.byteLength(content, "utf8") > MAX_PROVENANCE_BYTES) {
    throw new RunnerProvenanceError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new RunnerProvenanceError();
  }
  const result = ProvenanceSchema.safeParse(parsed);
  if (!result.success) {
    throw new RunnerProvenanceError();
  }
  return {
    schemaVersion: result.data.schema_version,
    imageDigest: result.data.image_digest,
    runnerProtocol: result.data.runner_protocol,
    runnerContract: result.data.runner_contract,
    builder: result.data.builder,
    source: result.data.source,
    ...(result.data.signature ? { signature: result.data.signature } : {}),
  };
}

export function verifyRunnerProvenance(
  provenance: RunnerProvenance,
  policy: RunnerProvenancePolicy,
): RunnerProvenanceFinding {
  if (provenance.imageDigest !== policy.imageDigest) {
    return {
      code: "runner.provenance-digest-mismatch",
      status: "fail",
      message: "Runner provenance does not match the requested image digest.",
    };
  }
  if (provenance.runnerProtocol !== policy.runnerProtocol) {
    return {
      code: "runner.provenance-protocol-mismatch",
      status: "fail",
      message: "Runner provenance protocol does not match the requested contract.",
    };
  }
  if (provenance.runnerContract !== policy.runnerContract) {
    return {
      code: "runner.provenance-contract-mismatch",
      status: "fail",
      message: "Runner provenance contract version does not match the requested contract.",
    };
  }
  if (policy.trustedBuilders && !policy.trustedBuilders.includes(provenance.builder)) {
    return {
      code: "runner.provenance-untrusted-builder",
      status: "fail",
      message: "Runner provenance builder is not trusted by the local policy.",
    };
  }
  if (policy.trustedSources && !policy.trustedSources.includes(provenance.source)) {
    return {
      code: "runner.provenance-untrusted-source",
      status: "fail",
      message: "Runner provenance source is not trusted by the local policy.",
    };
  }
  if (policy.requireSignature) {
    return {
      code: "runner.signature-verification-unavailable",
      status: "fail",
      message: "Signature verification is required but no approved verifier is configured.",
    };
  }
  return {
    code: "runner.provenance-valid",
    status: "pass",
    message: "Runner provenance matches the local policy.",
  };
}
