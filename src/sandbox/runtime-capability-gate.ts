import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const TimestampSchema = z.string().datetime({ offset: true });
const SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).min(32).max(512);

export const RUNTIME_CAPABILITY_ORDER = [
  "egress",
  "provider-credentials",
  "docker-microvm",
  "remote-worker",
] as const;

const RuntimeCapabilitySchema = z.enum(RUNTIME_CAPABILITY_ORDER);
const RuntimeArtifactSchema = z.object({
  imageDigest: DigestSchema.optional(),
  policyDigest: DigestSchema.optional(),
  runnerContract: z.literal("1").optional(),
}).strict();

const RuntimeAttestationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(["security-review", "controlled-environment"]),
  capability: RuntimeCapabilitySchema,
  evidenceDigest: DigestSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  signerKeyId: IdentifierSchema,
  signature: SignatureSchema,
}).strict();

const RuntimeActivationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("activation-receipt"),
  capability: RuntimeCapabilitySchema,
  contextDigest: DigestSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  signerKeyId: IdentifierSchema,
  signature: SignatureSchema,
}).strict();

const RuntimeTrustPolicyBundleSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("runtime-trust-policy"),
  reviewSignerKeys: z.record(IdentifierSchema, z.string().min(1)),
  environmentSignerKeys: z.record(IdentifierSchema, z.string().min(1)),
  activationSignerKeys: z.record(IdentifierSchema, z.string().min(1)),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  signerKeyId: IdentifierSchema,
  signature: SignatureSchema,
}).strict();

const RuntimeCapabilityGateSchema = z.object({
  schemaVersion: z.literal(1),
  capability: RuntimeCapabilitySchema,
  contextDigest: DigestSchema,
  activationReceipts: z.array(RuntimeActivationReceiptSchema).max(RUNTIME_CAPABILITY_ORDER.length),
  reviewAttestation: RuntimeAttestationSchema,
  environmentAttestation: RuntimeAttestationSchema,
  artifacts: RuntimeArtifactSchema,
}).strict();

export type RuntimeCapability = (typeof RUNTIME_CAPABILITY_ORDER)[number];
export type RuntimeAttestation = z.infer<typeof RuntimeAttestationSchema>;
export type RuntimeActivationReceipt = z.infer<typeof RuntimeActivationReceiptSchema>;
export type RuntimeArtifacts = z.infer<typeof RuntimeArtifactSchema>;
export type RuntimeCapabilityGateInput = z.infer<typeof RuntimeCapabilityGateSchema>;
export type RuntimeTrustPolicyBundle = z.infer<typeof RuntimeTrustPolicyBundleSchema>;

type RuntimeTrustPolicy = {
  reviewSignerKeys: Readonly<Record<string, string>>;
  environmentSignerKeys: Readonly<Record<string, string>>;
  activationSignerKeys: Readonly<Record<string, string>>;
};

export type RuntimeTrustRoot = {
  keyId: string;
  publicKeyPem: string;
};

export type TrustedRuntimeTrustPolicy = RuntimeTrustPolicy;
const trustedPolicyObjects = new WeakSet<object>();

export type RuntimeCapabilityFinding =
  | {
      code: "runtime.activation-approved" | "runtime.activation-already-recorded";
      status: "pass";
      message: string;
    }
  | {
      code:
        | "runtime.activation-input-invalid"
        | "runtime.attestation-invalid"
        | "runtime.activation-order"
        | "runtime.artifact-missing";
      status: "fail";
      message: string;
    };

type RuntimeEvidence = {
  capability: RuntimeCapability;
  contextDigest: string;
  activatedCapabilities: readonly RuntimeCapability[];
  artifacts: RuntimeArtifacts;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function computeRuntimeEvidenceDigest(evidence: RuntimeEvidence): string {
  return digest({
    capability: evidence.capability,
    contextDigest: evidence.contextDigest,
    activatedCapabilities: [...evidence.activatedCapabilities],
    artifacts: evidence.artifacts,
  });
}

export function runtimeAttestationSigningPayload(
  attestation: Omit<RuntimeAttestation, "signature">,
): string {
  return canonicalJson(attestation);
}

export function runtimeActivationReceiptSigningPayload(
  receipt: Omit<RuntimeActivationReceipt, "signature">,
): string {
  return canonicalJson(receipt);
}

export function runtimeTrustPolicyBundleSigningPayload(
  bundle: Omit<RuntimeTrustPolicyBundle, "signature">,
): string {
  return canonicalJson(bundle);
}

function makeTrustedRuntimeTrustPolicy(policy: RuntimeTrustPolicy): TrustedRuntimeTrustPolicy {
  const trusted = Object.freeze({
    reviewSignerKeys: Object.freeze({ ...policy.reviewSignerKeys }),
    environmentSignerKeys: Object.freeze({ ...policy.environmentSignerKeys }),
    activationSignerKeys: Object.freeze({ ...policy.activationSignerKeys }),
  });
  trustedPolicyObjects.add(trusted);
  return trusted;
}

export function parseRuntimeTrustPolicyBundle(
  content: string,
  trustedRoot: RuntimeTrustRoot,
  now = new Date(),
): TrustedRuntimeTrustPolicy | null {
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  const result = RuntimeTrustPolicyBundleSchema.safeParse(parsed);
  if (!result.success || result.data.signerKeyId !== trustedRoot.keyId) {
    return null;
  }
  const bundle = result.data;
  if (!validLifetime(bundle.issuedAt, bundle.expiresAt, now)) {
    return null;
  }
  const { signature: _signature, ...unsigned } = bundle;
  if (!verifySignedDocument(
    runtimeTrustPolicyBundleSigningPayload(unsigned),
    bundle.signature,
    trustedRoot.keyId,
    { [trustedRoot.keyId]: trustedRoot.publicKeyPem },
  )) {
    return null;
  }
  return makeTrustedRuntimeTrustPolicy({
    reviewSignerKeys: bundle.reviewSignerKeys,
    environmentSignerKeys: bundle.environmentSignerKeys,
    activationSignerKeys: bundle.activationSignerKeys,
  });
}

function failure(
  code: Exclude<RuntimeCapabilityFinding["code"], "runtime.activation-approved" | "runtime.activation-already-recorded">,
  message: string,
): RuntimeCapabilityFinding {
  return { code, status: "fail", message };
}

function requiresPolicy(capability: RuntimeCapability): boolean {
  return capability !== "docker-microvm";
}

function verifySignedDocument(
  payload: string,
  signature: string,
  signerKeyId: string,
  trustedKeys: Readonly<Record<string, string>>,
): boolean {
  const publicKeyPem = Object.prototype.hasOwnProperty.call(trustedKeys, signerKeyId)
    ? trustedKeys[signerKeyId]
    : undefined;
  if (!publicKeyPem) {
    return false;
  }
  try {
    return verifySignature(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function validLifetime(issuedAt: string, expiresAt: string, now: Date): boolean {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  const current = now.getTime();
  return Number.isFinite(issued)
    && Number.isFinite(expires)
    && issued <= current
    && expires > current
    && expires > issued;
}

function verifyAttestation(
  attestation: RuntimeAttestation,
  expectedKind: RuntimeAttestation["kind"],
  expectedCapability: RuntimeCapability,
  evidenceDigest: string,
  trustedKeys: Readonly<Record<string, string>>,
  now: Date,
): boolean {
  return attestation.kind === expectedKind
    && attestation.capability === expectedCapability
    && attestation.evidenceDigest === evidenceDigest
    && validLifetime(attestation.issuedAt, attestation.expiresAt, now)
    && verifySignedDocument(
      runtimeAttestationSigningPayload(((
        ({ signature: _signature, ...unsigned }) => unsigned
      )(attestation))),
      attestation.signature,
      attestation.signerKeyId,
      trustedKeys,
    );
}

function verifyActivationReceipt(
  receipt: RuntimeActivationReceipt,
  contextDigest: string,
  trustedKeys: Readonly<Record<string, string>>,
  now: Date,
): boolean {
  return receipt.contextDigest === contextDigest
    && validLifetime(receipt.issuedAt, receipt.expiresAt, now)
    && verifySignedDocument(
      runtimeActivationReceiptSigningPayload(((
        ({ signature: _signature, ...unsigned }) => unsigned
      )(receipt))),
      receipt.signature,
      receipt.signerKeyId,
      trustedKeys,
    );
}

export function evaluateRuntimeCapabilityGate(
  input: unknown,
  trustPolicy: TrustedRuntimeTrustPolicy,
  now = new Date(),
): RuntimeCapabilityFinding {
  if (typeof trustPolicy !== "object" || trustPolicy === null || !trustedPolicyObjects.has(trustPolicy)) {
    return failure(
      "runtime.attestation-invalid",
      "Runtime trust policy is invalid.",
    );
  }
  const parsed = RuntimeCapabilityGateSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "runtime.activation-input-invalid",
      "Runtime capability activation input is invalid.",
    );
  }

  const value = parsed.data;
  const activatedCapabilities = value.activationReceipts.map((receipt) => receipt.capability);
  if (new Set(activatedCapabilities).size !== activatedCapabilities.length) {
    return failure(
      "runtime.activation-input-invalid",
      "Runtime activation receipts must identify unique capabilities.",
    );
  }
  if (!value.activationReceipts.every((receipt) => verifyActivationReceipt(
    receipt,
    value.contextDigest,
    trustPolicy.activationSignerKeys,
    now,
  ))) {
    return failure(
      "runtime.attestation-invalid",
      "Runtime activation receipts are not trusted or have expired.",
    );
  }

  const evidenceDigest = computeRuntimeEvidenceDigest({
    capability: value.capability,
    contextDigest: value.contextDigest,
    activatedCapabilities,
    artifacts: value.artifacts,
  });
  if (!verifyAttestation(
    value.reviewAttestation,
    "security-review",
    value.capability,
    evidenceDigest,
    trustPolicy.reviewSignerKeys,
    now,
  )) {
    return failure(
      "runtime.attestation-invalid",
      "The independent security review attestation is not trusted, current, or bound to this activation request.",
    );
  }
  if (!verifyAttestation(
    value.environmentAttestation,
    "controlled-environment",
    value.capability,
    evidenceDigest,
    trustPolicy.environmentSignerKeys,
    now,
  )) {
    return failure(
      "runtime.attestation-invalid",
      "The controlled-environment attestation is not trusted, current, or bound to this activation request.",
    );
  }

  const capabilityIndex = RUNTIME_CAPABILITY_ORDER.indexOf(value.capability);
  const activated = new Set(activatedCapabilities);
  const hasLaterCapability = activatedCapabilities.some((capability) =>
    RUNTIME_CAPABILITY_ORDER.indexOf(capability) > capabilityIndex,
  );
  const missingEarlierCapability = RUNTIME_CAPABILITY_ORDER
    .slice(0, capabilityIndex)
    .some((capability) => !activated.has(capability));
  if (hasLaterCapability || missingEarlierCapability) {
    return failure(
      "runtime.activation-order",
      "Runtime capabilities must be activated in the declared order.",
    );
  }

  const missingImage = value.artifacts.imageDigest === undefined;
  const missingPolicy = requiresPolicy(value.capability) && value.artifacts.policyDigest === undefined;
  const missingRunnerContract = value.artifacts.runnerContract !== "1";
  if (missingImage || missingPolicy || missingRunnerContract) {
    return failure(
      "runtime.artifact-missing",
      requiresPolicy(value.capability)
        ? "The capability requires an immutable image and policy artifact."
        : "The capability requires an immutable image and Runner contract artifact.",
    );
  }

  if (activated.has(value.capability)) {
    return {
      code: "runtime.activation-already-recorded",
      status: "pass",
      message: "Runtime capability activation was already recorded by a trusted receipt.",
    };
  }

  return {
    code: "runtime.activation-approved",
    status: "pass",
    message: "Runtime capability activation prerequisites are satisfied by trusted attestations.",
  };
}
