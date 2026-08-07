import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeRuntimeEvidenceDigest,
  evaluateRuntimeCapabilityGate,
  parseRuntimeTrustPolicyBundle,
  runtimeActivationReceiptSigningPayload,
  runtimeAttestationSigningPayload,
  runtimeTrustPolicyBundleSigningPayload,
  type RuntimeActivationReceipt,
  type RuntimeAttestation,
  type RuntimeCapability,
  type RuntimeCapabilityGateInput,
  type TrustedRuntimeTrustPolicy,
} from "../../src/sandbox/runtime-capability-gate";

const digest = `sha256:${"a".repeat(64)}`;
const contextDigest = `sha256:${"c".repeat(64)}`;
const now = new Date("2026-08-05T12:00:00.000Z");
const issuedAt = "2026-08-05T00:00:00.000Z";
const expiresAt = "2026-08-06T00:00:00.000Z";

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const review = keyPair();
const environment = keyPair();
const activation = keyPair();
const root = keyPair();
const trustPolicyBundle = {
  schemaVersion: 1 as const,
  kind: "runtime-trust-policy" as const,
  reviewSignerKeys: { "review-key": review.publicKey },
  environmentSignerKeys: { "environment-key": environment.publicKey },
  activationSignerKeys: { "activation-key": activation.publicKey },
  issuedAt,
  expiresAt,
  signerKeyId: "runtime-root",
};
const trustPolicy = parseRuntimeTrustPolicyBundle(JSON.stringify({
  ...trustPolicyBundle,
  signature: sign(
    null,
    Buffer.from(runtimeTrustPolicyBundleSigningPayload(trustPolicyBundle), "utf8"),
    root.privateKey,
  ).toString("base64url"),
}), { keyId: "runtime-root", publicKeyPem: root.publicKey }, now);
if (trustPolicy === null) {
  throw new Error("test trust policy bundle did not validate");
}

function signedAttestation(
  kind: RuntimeAttestation["kind"],
  capability: RuntimeCapability,
  evidenceDigest: string,
): RuntimeAttestation {
  const unsigned = {
    schemaVersion: 1 as const,
    kind,
    capability,
    evidenceDigest,
    issuedAt,
    expiresAt,
    signerKeyId: kind === "security-review" ? "review-key" : "environment-key",
  };
  const privateKey = kind === "security-review" ? review.privateKey : environment.privateKey;
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(runtimeAttestationSigningPayload(unsigned), "utf8"), privateKey).toString("base64url"),
  };
}

function signedReceipt(capability: RuntimeCapability): RuntimeActivationReceipt {
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "activation-receipt" as const,
    capability,
    contextDigest,
    issuedAt,
    expiresAt,
    signerKeyId: "activation-key",
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(runtimeActivationReceiptSigningPayload(unsigned), "utf8"), activation.privateKey).toString("base64url"),
  };
}

function input(options: {
  capability?: RuntimeCapability;
  activatedCapabilities?: RuntimeCapability[];
  artifacts?: RuntimeCapabilityGateInput["artifacts"];
} = {}): RuntimeCapabilityGateInput {
  const capability = options.capability ?? "egress";
  const activatedCapabilities = options.activatedCapabilities ?? [];
  const artifacts = options.artifacts ?? {
    imageDigest: digest,
    policyDigest: digest,
    runnerContract: "1" as const,
  };
  const evidenceDigest = computeRuntimeEvidenceDigest({ capability, contextDigest, activatedCapabilities, artifacts });
  return {
    schemaVersion: 1,
    capability,
    contextDigest,
    activationReceipts: activatedCapabilities.map(signedReceipt),
    reviewAttestation: signedAttestation("security-review", capability, evidenceDigest),
    environmentAttestation: signedAttestation("controlled-environment", capability, evidenceDigest),
    artifacts,
  };
}

describe("runtime capability activation gate", () => {
  it("requires trusted, signed review and environment attestations", () => {
    const unsigned = input();
    unsigned.reviewAttestation.signerKeyId = "unknown-reviewer";
    expect(evaluateRuntimeCapabilityGate(unsigned, trustPolicy, now)).toMatchObject({
      code: "runtime.attestation-invalid",
      status: "fail",
    });

    const environmentMismatch = input();
    environmentMismatch.environmentAttestation.evidenceDigest = digest;
    expect(evaluateRuntimeCapabilityGate(environmentMismatch, trustPolicy, now)).toMatchObject({
      code: "runtime.attestation-invalid",
      status: "fail",
    });

    expect(evaluateRuntimeCapabilityGate(input(), {} as TrustedRuntimeTrustPolicy, now)).toEqual({
      code: "runtime.attestation-invalid",
      status: "fail",
      message: "Runtime trust policy is invalid.",
    });

    expect(evaluateRuntimeCapabilityGate(input(), {
      reviewSignerKeys: { "review-key": review.publicKey },
      environmentSignerKeys: { "environment-key": environment.publicKey },
      activationSignerKeys: { "activation-key": activation.publicKey },
    } as TrustedRuntimeTrustPolicy, now)).toMatchObject({
      code: "runtime.attestation-invalid",
      status: "fail",
    });

    const invalidBundle = { ...trustPolicyBundle, signature: "A".repeat(86) };
    expect(parseRuntimeTrustPolicyBundle(JSON.stringify(invalidBundle), {
      keyId: "runtime-root",
      publicKeyPem: root.publicKey,
    }, now)).toBeNull();
  });

  it("approves the first egress capability only with signed attestations and immutable artifacts", () => {
    expect(evaluateRuntimeCapabilityGate(input(), trustPolicy, now)).toEqual({
      code: "runtime.activation-approved",
      status: "pass",
      message: "Runtime capability activation prerequisites are satisfied by trusted attestations.",
    });
    expect(evaluateRuntimeCapabilityGate(input({ artifacts: { runnerContract: "1" } }), trustPolicy, now)).toEqual({
      code: "runtime.artifact-missing",
      status: "fail",
      message: "The capability requires an immutable image and policy artifact.",
    });
  });

  it("enforces egress, credentials, Docker/microVM, then remote Worker order", () => {
    expect(evaluateRuntimeCapabilityGate(input({ capability: "provider-credentials" }), trustPolicy, now)).toMatchObject({
      code: "runtime.activation-order",
      status: "fail",
    });
    expect(evaluateRuntimeCapabilityGate(input({
      capability: "provider-credentials",
      activatedCapabilities: ["egress"],
    }), trustPolicy, now)).toMatchObject({ code: "runtime.activation-approved", status: "pass" });
    expect(evaluateRuntimeCapabilityGate(input({
      capability: "docker-microvm",
      activatedCapabilities: ["egress", "provider-credentials"],
      artifacts: { imageDigest: digest, runnerContract: "1" },
    }), trustPolicy, now)).toMatchObject({ code: "runtime.activation-approved", status: "pass" });
    expect(evaluateRuntimeCapabilityGate(input({
      capability: "remote-worker",
      activatedCapabilities: ["egress", "provider-credentials", "docker-microvm"],
    }), trustPolicy, now)).toMatchObject({ code: "runtime.activation-approved", status: "pass" });
  });

  it("rejects forged activation receipts and tampered evidence", () => {
    const forged = input({ activatedCapabilities: ["egress"] });
    forged.activationReceipts[0]!.capability = "docker-microvm";
    expect(evaluateRuntimeCapabilityGate(forged, trustPolicy, now)).toMatchObject({
      code: "runtime.attestation-invalid",
      status: "fail",
    });

    const tampered = input();
    tampered.artifacts.imageDigest = `sha256:${"b".repeat(64)}`;
    expect(evaluateRuntimeCapabilityGate(tampered, trustPolicy, now)).toMatchObject({
      code: "runtime.attestation-invalid",
      status: "fail",
    });
  });

  it("accepts an exact already-recorded activation only from a trusted receipt and rechecks artifacts", () => {
    expect(evaluateRuntimeCapabilityGate(input({ activatedCapabilities: ["egress"] }), trustPolicy, now)).toEqual({
      code: "runtime.activation-already-recorded",
      status: "pass",
      message: "Runtime capability activation was already recorded by a trusted receipt.",
    });

    const missingArtifact = input({
      activatedCapabilities: ["egress"],
      artifacts: { runnerContract: "1" },
    });
    expect(evaluateRuntimeCapabilityGate(missingArtifact, trustPolicy, now)).toMatchObject({
      code: "runtime.artifact-missing",
      status: "fail",
    });
  });

  it("fails closed for unknown, duplicated, or expired gate input", () => {
    expect(evaluateRuntimeCapabilityGate({ ...input(), capability: "unknown" }, trustPolicy, now)).toEqual({
      code: "runtime.activation-input-invalid",
      status: "fail",
      message: "Runtime capability activation input is invalid.",
    });

    const duplicate = input({ activatedCapabilities: ["egress"] });
    duplicate.activationReceipts.push(duplicate.activationReceipts[0]!);
    expect(evaluateRuntimeCapabilityGate(duplicate, trustPolicy, now)).toMatchObject({
      code: "runtime.activation-input-invalid",
      status: "fail",
    });

    const expired = input();
    expired.reviewAttestation.expiresAt = "2026-08-05T11:59:59.000Z";
    expect(evaluateRuntimeCapabilityGate(expired, trustPolicy, now)).toMatchObject({
      code: "runtime.attestation-invalid",
      status: "fail",
    });
  });
});
