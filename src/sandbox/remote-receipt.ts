import { createPublicKey, verify as verifySignature } from "node:crypto";

import { z } from "zod";

import type { RemoteLifecycleEvent } from "./remote-contract.js";

export const MAX_REMOTE_RECEIPT_TTL_MS = 60 * 60 * 1000;

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const IdentifierSchema = z.string().regex(/^[A-Za-z0-9._:-]+$/).min(1).max(128);
const AttemptSchema = z.number().int().min(1).max(16);
const TimestampSchema = z.string().datetime({ offset: true });
const SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).min(32).max(512);
export const RemoteWorkerReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(["worker-event", "cleanup-proof"]),
  runId: IdentifierSchema,
  attempt: AttemptSchema,
  resourceId: IdentifierSchema,
  eventDigest: DigestSchema,
  cleanupEvidenceDigest: DigestSchema.optional(),
  workerKeyId: IdentifierSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  signature: SignatureSchema,
}).strict();

export type RemoteWorkerReceipt = z.infer<typeof RemoteWorkerReceiptSchema>;

export type RemoteReceiptFinding =
  | {
      code: "remote.receipt-valid";
      status: "pass";
      message: "Remote Worker receipt is authenticated and correctly bound.";
    }
  | {
      code:
        | "remote.receipt-invalid"
        | "remote.receipt-expired"
        | "remote.receipt-binding-invalid"
        | "remote.worker-untrusted"
        | "remote.receipt-signature-invalid";
      status: "fail";
      message: string;
    };

export type RemoteReceiptExpectation = {
  runId: string;
  attempt: number;
  resourceId: string;
  eventDigest: string;
  cleanupEvidenceDigest?: string;
};

export type RemoteCompletionExpectation = {
  attempt: number;
  resourceId: string;
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

export function remoteWorkerReceiptSigningPayload(
  receipt: Omit<RemoteWorkerReceipt, "signature">,
): string {
  return canonicalJson(receipt);
}

function failure(
  code: Exclude<RemoteReceiptFinding["code"], "remote.receipt-valid">,
  message: string,
): RemoteReceiptFinding {
  return { code, status: "fail", message };
}

function validLifetime(issuedAt: string, expiresAt: string, now: Date): boolean {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  const current = now.getTime();
  return Number.isFinite(issued)
    && Number.isFinite(expires)
    && issued <= current
    && expires > current
    && expires > issued
    && expires - issued <= MAX_REMOTE_RECEIPT_TTL_MS;
}

function verifySignatureForKey(
  receipt: RemoteWorkerReceipt,
  trustedWorkerKeys: Readonly<Record<string, string>>,
): boolean {
  const publicKeyPem = Object.prototype.hasOwnProperty.call(trustedWorkerKeys, receipt.workerKeyId)
    ? trustedWorkerKeys[receipt.workerKeyId]
    : undefined;
  if (!publicKeyPem) {
    return false;
  }
  const { signature: _signature, ...unsigned } = receipt;
  try {
    return verifySignature(
      null,
      Buffer.from(remoteWorkerReceiptSigningPayload(unsigned), "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(receipt.signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function verifyRemoteWorkerReceipt(
  receipt: unknown,
  expected: RemoteReceiptExpectation,
  trustedWorkerKeys: Readonly<Record<string, string>>,
  now = new Date(),
): RemoteReceiptFinding {
  const parsed = RemoteWorkerReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    return failure("remote.receipt-invalid", "Remote Worker receipt schema is invalid.");
  }
  const value = parsed.data;
  if (
    value.runId !== expected.runId
    || value.attempt !== expected.attempt
    || value.resourceId !== expected.resourceId
    || value.eventDigest !== expected.eventDigest
    || (expected.cleanupEvidenceDigest === undefined
      ? value.kind !== "worker-event" || value.cleanupEvidenceDigest !== undefined
      : value.kind !== "cleanup-proof" || value.cleanupEvidenceDigest !== expected.cleanupEvidenceDigest)
  ) {
    return failure("remote.receipt-binding-invalid", "Remote Worker receipt is not bound to the expected evidence.");
  }
  if (!validLifetime(value.issuedAt, value.expiresAt, now)) {
    return failure("remote.receipt-expired", "Remote Worker receipt is expired or not yet valid.");
  }
  if (!Object.prototype.hasOwnProperty.call(trustedWorkerKeys, value.workerKeyId)) {
    return failure("remote.worker-untrusted", "Remote Worker signing key is not trusted.");
  }
  if (!verifySignatureForKey(value, trustedWorkerKeys)) {
    return failure("remote.receipt-signature-invalid", "Remote Worker receipt signature is invalid.");
  }
  return {
    code: "remote.receipt-valid",
    status: "pass",
    message: "Remote Worker receipt is authenticated and correctly bound.",
  };
}

export function verifyRemoteCompletionReceipt(
  event: RemoteLifecycleEvent,
  receipt: unknown,
  expected: RemoteCompletionExpectation,
  trustedWorkerKeys: Readonly<Record<string, string>>,
  now = new Date(),
): RemoteReceiptFinding {
  if (event.type === "run.finished" || event.type === "worker.failed") {
    return verifyRemoteWorkerReceipt(receipt, {
      runId: event.run_id,
      attempt: expected.attempt,
      resourceId: expected.resourceId,
      eventDigest: event.event_digest,
    }, trustedWorkerKeys, now);
  }
  if (event.type === "teardown.completed") {
    return verifyRemoteWorkerReceipt(receipt, {
      runId: event.run_id,
      attempt: event.cleanup_proof.attempt,
      resourceId: event.cleanup_proof.resource_id,
      eventDigest: event.cleanup_proof.event_digest,
      cleanupEvidenceDigest: event.cleanup_proof.evidence_digest,
    }, trustedWorkerKeys, now);
  }
  return failure("remote.receipt-binding-invalid", "Remote event type cannot be authenticated as completion evidence.");
}
