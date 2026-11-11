import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  remoteWorkerReceiptSigningPayload,
  verifyRemoteCompletionReceipt,
  verifyRemoteWorkerReceipt,
  type RemoteWorkerReceipt,
} from "../../src/sandbox/remote-receipt";
import { verifyRemoteLifecycleReceipt, type RemoteLifecycleEvent } from "../../src/sandbox/remote-contract";

const now = new Date("2026-08-05T12:00:00.000Z");
const issuedAt = "2026-08-05T11:30:00.000Z";
const expiresAt = "2026-08-05T12:30:00.000Z";
const eventDigest = `sha256:${"a".repeat(64)}`;
const cleanupDigest = `sha256:${"b".repeat(64)}`;
const keyPair = generateKeyPairSync("ed25519");
const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const trustedWorkerKeys = { "worker-key": publicKey };

function receipt(overrides: Partial<Omit<RemoteWorkerReceipt, "signature">> = {}): RemoteWorkerReceipt {
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "worker-event" as const,
    runId: "run-1",
    attempt: 1,
    resourceId: "worker-1",
    eventDigest,
    issuedAt,
    expiresAt,
    workerKeyId: "worker-key",
    ...overrides,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(remoteWorkerReceiptSigningPayload(unsigned), "utf8"),
      keyPair.privateKey,
    ).toString("base64url"),
  };
}

const finishedEvent: RemoteLifecycleEvent = {
  schema_version: 1,
  run_id: "run-1",
  type: "run.finished",
  status: "failed",
  exit_code: 1,
  event_digest: eventDigest,
};

describe("authenticated remote Worker receipts", () => {
  it("accepts a current signed Worker event receipt bound to the expected run", () => {
    expect(verifyRemoteWorkerReceipt(receipt(), {
      runId: "run-1",
      attempt: 1,
      resourceId: "worker-1",
      eventDigest,
    }, trustedWorkerKeys, now)).toEqual({
      code: "remote.receipt-valid",
      status: "pass",
      message: "Remote Worker receipt is authenticated and correctly bound.",
    });
    expect(verifyRemoteCompletionReceipt(finishedEvent, receipt(), {
      attempt: 1,
      resourceId: "worker-1",
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-valid", status: "pass" });
    expect(verifyRemoteLifecycleReceipt(finishedEvent, receipt(), {
      attempt: 1,
      resourceId: "worker-1",
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-valid", status: "pass" });
  });

  it("requires a signed cleanup-proof receipt for cleanup completion", () => {
    const cleanup = receipt({ kind: "cleanup-proof", cleanupEvidenceDigest: cleanupDigest });
    expect(verifyRemoteWorkerReceipt(cleanup, {
      runId: "run-1",
      attempt: 1,
      resourceId: "worker-1",
      eventDigest,
      cleanupEvidenceDigest: cleanupDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-valid", status: "pass" });

    expect(verifyRemoteWorkerReceipt(receipt(), {
      runId: "run-1",
      attempt: 1,
      resourceId: "worker-1",
      eventDigest,
      cleanupEvidenceDigest: cleanupDigest,
    }, trustedWorkerKeys, now)).toMatchObject({
      code: "remote.receipt-binding-invalid",
      status: "fail",
    });
  });

  it("rejects unknown workers, invalid signatures, expiry, and replayed evidence", () => {
    expect(verifyRemoteWorkerReceipt(receipt({ workerKeyId: "other-worker" }), {
      runId: "run-1", attempt: 1, resourceId: "worker-1", eventDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.worker-untrusted", status: "fail" });

    const tampered = receipt();
    tampered.eventDigest = `sha256:${"c".repeat(64)}`;
    expect(verifyRemoteWorkerReceipt(tampered, {
      runId: "run-1", attempt: 1, resourceId: "worker-1", eventDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-binding-invalid", status: "fail" });

    expect(verifyRemoteWorkerReceipt(receipt({ expiresAt: "2026-08-05T11:59:59.000Z" }), {
      runId: "run-1", attempt: 1, resourceId: "worker-1", eventDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-expired", status: "fail" });

    expect(verifyRemoteWorkerReceipt(receipt({ expiresAt: "2026-08-05T13:00:01.000Z" }), {
      runId: "run-1", attempt: 1, resourceId: "worker-1", eventDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-expired", status: "fail" });

    expect(verifyRemoteWorkerReceipt(receipt({ runId: "run-2" }), {
      runId: "run-1", attempt: 1, resourceId: "worker-1", eventDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-binding-invalid", status: "fail" });
  });

  it("rejects malformed receipts before signature verification", () => {
    expect(verifyRemoteWorkerReceipt({ runId: "run-1" }, {
      runId: "run-1", attempt: 1, resourceId: "worker-1", eventDigest,
    }, trustedWorkerKeys, now)).toMatchObject({ code: "remote.receipt-invalid", status: "fail" });
  });
});
