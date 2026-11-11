import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeRuntimeEvidenceDigest,
  parseRuntimeTrustPolicyBundle,
  runtimeActivationReceiptSigningPayload,
  runtimeAttestationSigningPayload,
  runtimeTrustPolicyBundleSigningPayload,
  type RuntimeActivationReceipt,
  type RuntimeAttestation,
  type RuntimeCapability,
  type RuntimeCapabilityGateInput,
  type RuntimeTrustPolicyBundle,
} from "../../src/sandbox/runtime-capability-gate";
import {
  activateRuntimeCapability,
  createRuntimeActivationBoundary,
} from "../../src/sandbox/runtime-activation-boundary";

const now = new Date("2026-08-05T12:00:00.000Z");
const issuedAt = "2026-08-05T00:00:00.000Z";
const expiresAt = "2026-08-06T00:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;
const contextDigest = `sha256:${"c".repeat(64)}`;

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const root = keyPair();
const review = keyPair();
const environment = keyPair();
const activation = keyPair();
const bundle: Omit<RuntimeTrustPolicyBundle, "signature"> = {
  schemaVersion: 1,
  kind: "runtime-trust-policy",
  reviewSignerKeys: { "review-key": review.publicKey },
  environmentSignerKeys: { "environment-key": environment.publicKey },
  activationSignerKeys: { "activation-key": activation.publicKey },
  issuedAt,
  expiresAt,
  signerKeyId: "runtime-root",
};
const trustedPolicy = parseRuntimeTrustPolicyBundle(JSON.stringify({
  ...bundle,
  signature: sign(null, Buffer.from(runtimeTrustPolicyBundleSigningPayload(bundle), "utf8"), root.privateKey).toString("base64url"),
}), { keyId: "runtime-root", publicKeyPem: root.publicKey }, now);
if (trustedPolicy === null) {
  throw new Error("boundary test policy did not validate");
}

function attestation(kind: RuntimeAttestation["kind"], capability: RuntimeCapability, evidenceDigest: string): RuntimeAttestation {
  const unsigned = {
    schemaVersion: 1 as const,
    kind,
    capability,
    evidenceDigest,
    issuedAt,
    expiresAt,
    signerKeyId: kind === "security-review" ? "review-key" : "environment-key",
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(runtimeAttestationSigningPayload(unsigned), "utf8"),
      kind === "security-review" ? review.privateKey : environment.privateKey,
    ).toString("base64url"),
  };
}

function receipt(capability: RuntimeCapability): RuntimeActivationReceipt {
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

function input(capability: RuntimeCapability = "egress", activated: RuntimeCapability[] = []): RuntimeCapabilityGateInput {
  const artifacts = { imageDigest: digest, policyDigest: digest, runnerContract: "1" as const };
  const evidenceDigest = computeRuntimeEvidenceDigest({ capability, contextDigest, activatedCapabilities: activated, artifacts });
  return {
    schemaVersion: 1,
    capability,
    contextDigest,
    activationReceipts: activated.map(receipt),
    reviewAttestation: attestation("security-review", capability, evidenceDigest),
    environmentAttestation: attestation("controlled-environment", capability, evidenceDigest),
    artifacts,
  };
}

describe("runtime activation boundary", () => {
  it("denies activation without a deployment policy", () => {
    const boundary = createRuntimeActivationBoundary(null);

    expect(boundary.authorize(input(), now)).toEqual({
      code: "runtime.attestation-invalid",
      status: "fail",
      message: "Runtime activation policy is not configured.",
    });
    expect(boundary.isEnabled("egress")).toBe(false);
  });

  it("records only trusted ordered activations and preserves context binding", () => {
    const boundary = createRuntimeActivationBoundary({
      trustPolicy: trustedPolicy,
      rootKeyId: "runtime-root",
      rootFingerprint: digest,
    });

    expect(boundary.authorize(input(), now)).toMatchObject({ code: "runtime.activation-approved", status: "pass" });
    expect(boundary.isEnabled("egress")).toBe(true);
    expect(boundary.authorize(input("provider-credentials", ["egress"]), now)).toMatchObject({
      code: "runtime.activation-approved",
      status: "pass",
    });
    expect(boundary.isEnabled("provider-credentials")).toBe(true);

    const changedContext = input();
    changedContext.contextDigest = `sha256:${"d".repeat(64)}`;
    expect(boundary.authorize(changedContext, now)).toMatchObject({
      code: "runtime.activation-input-invalid",
      status: "fail",
    });
  });

  it("rejects out-of-order activation and malformed input without side effects", () => {
    const boundary = createRuntimeActivationBoundary({
      trustPolicy: trustedPolicy,
      rootKeyId: "runtime-root",
      rootFingerprint: digest,
    });

    expect(boundary.authorize(input("remote-worker"), now)).toMatchObject({
      code: "runtime.activation-order",
      status: "fail",
    });
    expect(boundary.authorize({ capability: "remote-worker" }, now)).toMatchObject({
      code: "runtime.activation-input-invalid",
      status: "fail",
    });
    expect(boundary.isEnabled("remote-worker")).toBe(false);
  });

  it("does not start a capability until the activation boundary approves it", async () => {
    const boundary = createRuntimeActivationBoundary(null);
    let starts = 0;

    await expect(activateRuntimeCapability(
      boundary,
      input("egress"),
      () => {
        starts += 1;
        return "started";
      },
      now,
    )).resolves.toMatchObject({ finding: { status: "fail" } });
    expect(starts).toBe(0);
  });

  it("treats an absent activation boundary as an untrusted boundary", async () => {
    let starts = 0;

    await expect(activateRuntimeCapability(
      null,
      input("egress"),
      () => {
        starts += 1;
        return "started";
      },
      now,
    )).resolves.toMatchObject({
      finding: {
        code: "runtime.activation-input-invalid",
        status: "fail",
      },
    });
    expect(starts).toBe(0);
  });

  it("rejects a structurally forged boundary", async () => {
    const forgedBoundary = {
      authorize: () => ({
        code: "runtime.activation-approved" as const,
        status: "pass" as const,
        message: "forged",
      }),
      isEnabled: () => true,
    };
    let starts = 0;

    await expect(activateRuntimeCapability(
      forgedBoundary,
      input(),
      () => {
        starts += 1;
        return "started";
      },
      now,
    )).resolves.toMatchObject({
      finding: {
        code: "runtime.activation-input-invalid",
        status: "fail",
      },
    });
    expect(starts).toBe(0);
  });

  it("freezes trusted boundary state against post-creation authorization replacement", () => {
    const boundary = createRuntimeActivationBoundary(null);
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(() => Object.assign(boundary, {
      authorize: () => ({
        code: "runtime.activation-approved" as const,
        status: "pass" as const,
        message: "forged",
      }),
    })).toThrow();
  });
});
