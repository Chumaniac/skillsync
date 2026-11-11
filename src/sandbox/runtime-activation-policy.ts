import { createHash, createPublicKey } from "node:crypto";

import { z } from "zod";

import {
  parseRuntimeTrustPolicyBundle,
  type RuntimeTrustRoot,
  type TrustedRuntimeTrustPolicy,
} from "./runtime-capability-gate.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const RuntimeActivationPolicySourceSchema = z.object({
  source: z.literal("deployment-config"),
  trustBundleJson: z.string().min(1).max(64 * 1024),
}).strict();

export type RuntimeActivationPolicySource = z.infer<typeof RuntimeActivationPolicySourceSchema>;

export type RuntimeActivationRootPin = {
  trustedRoot: RuntimeTrustRoot;
  expectedRootFingerprint: string;
};

export type RuntimeActivationPolicy = {
  trustPolicy: TrustedRuntimeTrustPolicy;
  rootKeyId: string;
  rootFingerprint: string;
};

function rootFingerprint(root: RuntimeTrustRoot): string | null {
  try {
    const publicKey = createPublicKey(root.publicKeyPem);
    const der = publicKey.export({ type: "spki", format: "der" });
    return `sha256:${createHash("sha256").update(der).digest("hex")}`;
  } catch {
    return null;
  }
}

export function loadRuntimeActivationPolicy(
  source: unknown,
  rootPin: RuntimeActivationRootPin,
  now = new Date(),
): RuntimeActivationPolicy | null {
  const parsed = RuntimeActivationPolicySourceSchema.safeParse(source);
  if (!parsed.success) {
    return null;
  }

  if (!DigestSchema.safeParse(rootPin.expectedRootFingerprint).success) {
    return null;
  }
  const actualFingerprint = rootFingerprint(rootPin.trustedRoot);
  if (actualFingerprint === null || actualFingerprint !== rootPin.expectedRootFingerprint) {
    return null;
  }

  const trustPolicy = parseRuntimeTrustPolicyBundle(parsed.data.trustBundleJson, rootPin.trustedRoot, now);
  if (trustPolicy === null) {
    return null;
  }

  return Object.freeze({
    trustPolicy,
    rootKeyId: rootPin.trustedRoot.keyId,
    rootFingerprint: actualFingerprint,
  });
}

export function parseRuntimeActivationPolicy(
  content: string,
  rootPin: RuntimeActivationRootPin,
  now = new Date(),
): RuntimeActivationPolicy | null {
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) {
    return null;
  }
  try {
    return loadRuntimeActivationPolicy(JSON.parse(content) as unknown, rootPin, now);
  } catch {
    return null;
  }
}
