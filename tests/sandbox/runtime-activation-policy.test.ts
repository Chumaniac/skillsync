import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  runtimeTrustPolicyBundleSigningPayload,
  type RuntimeTrustPolicyBundle,
} from "../../src/sandbox/runtime-capability-gate";
import {
  loadRuntimeActivationPolicy,
  parseRuntimeActivationPolicy,
  type RuntimeActivationRootPin,
} from "../../src/sandbox/runtime-activation-policy";

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
const bundleJson = JSON.stringify({
  ...bundle,
  signature: sign(
    null,
    Buffer.from(runtimeTrustPolicyBundleSigningPayload(bundle), "utf8"),
    root.privateKey,
  ).toString("base64url"),
});
const rootFingerprint = `sha256:${createHash("sha256")
  .update(createPublicKey(root.publicKey).export({ type: "spki", format: "der" }))
  .digest("hex")}`;

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "deployment-config",
    trustBundleJson: bundleJson,
    ...overrides,
  };
}

function rootPin(overrides: Partial<RuntimeActivationRootPin> = {}): RuntimeActivationRootPin {
  return {
    trustedRoot: { keyId: "runtime-root", publicKeyPem: root.publicKey },
    expectedRootFingerprint: rootFingerprint,
    ...overrides,
  };
}

describe("runtime activation policy bootstrap", () => {
  it("loads a signed deployment policy only when the root fingerprint matches", () => {
    const policy = loadRuntimeActivationPolicy(source(), rootPin(), now);

    expect(policy).not.toBeNull();
    expect(policy).toMatchObject({
      rootKeyId: "runtime-root",
      rootFingerprint,
    });
    expect(policy?.trustPolicy).toBeDefined();
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("parses the explicit source JSON without reading ambient state", () => {
    expect(parseRuntimeActivationPolicy(JSON.stringify(source()), rootPin(), now)).not.toBeNull();
  });

  it("fails closed for an untrusted source", () => {
    expect(loadRuntimeActivationPolicy(source({ source: "request" }), rootPin(), now)).toBeNull();
    expect(loadRuntimeActivationPolicy(source({ unexpected: true }), rootPin(), now)).toBeNull();
  });

  it.each([
    ["invalid fingerprint", { expectedRootFingerprint: "sha256:bad" }],
    ["mismatched fingerprint", { expectedRootFingerprint: `sha256:${"b".repeat(64)}` }],
    ["wrong root key", { trustedRoot: { keyId: "other-root", publicKeyPem: root.publicKey } }],
  ])("fails closed for %s", (_label, override) => {
    expect(loadRuntimeActivationPolicy(source(), rootPin(override), now)).toBeNull();
  });

  it("fails closed for an invalid signed bundle", () => {
    expect(loadRuntimeActivationPolicy(
      source({ trustBundleJson: bundleJson.replace("runtime-root", "other-root") }),
      rootPin(),
      now,
    )).toBeNull();
  });

  it("rejects expired bundles and unknown source fields", () => {
    const expiredBundle = { ...bundle, expiresAt: "2026-08-05T11:59:59.000Z" };
    const expiredJson = JSON.stringify({
      ...expiredBundle,
      signature: sign(
        null,
        Buffer.from(runtimeTrustPolicyBundleSigningPayload(expiredBundle), "utf8"),
        root.privateKey,
      ).toString("base64url"),
    });
    expect(loadRuntimeActivationPolicy(source({ trustBundleJson: expiredJson }), rootPin(), now)).toBeNull();
  });
});
