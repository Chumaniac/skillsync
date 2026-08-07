import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseRemoteLifecycleEvent,
  RemoteRunMachine,
  RemoteLifecycleConfigurationError,
  type RemoteLifecycleEvent,
  type RemoteRunOptions,
} from "../../src/sandbox/remote-contract";
import {
  remoteWorkerReceiptSigningPayload,
  type RemoteWorkerReceipt,
} from "../../src/sandbox/remote-receipt";

const digest = `sha256:${"a".repeat(64)}`;
const retryStagingDigest = `sha256:${"b".repeat(64)}`;
const retryEventDigest = `sha256:${"c".repeat(64)}`;
const runId = "remote-run-1";
const allResources = ["artifacts", "credentials", "logs", "workspace"];
const workerKeyPair = generateKeyPairSync("ed25519");
const workerPublicKey = workerKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const contractOptions = { mode: "contract" as const };

function cleanupProof(overrides: {
  attempt?: number;
  runId?: string;
  resourceId?: string;
  stagingDigest?: string;
  eventDigest?: string;
  deleted?: string[];
} = {}) {
  const body = {
    attempt: overrides.attempt ?? 1,
    run_id: overrides.runId ?? runId,
    resource_id: overrides.resourceId ?? "worker-1",
    staging_digest: overrides.stagingDigest ?? digest,
    event_digest: overrides.eventDigest ?? digest,
    deleted: [...(overrides.deleted ?? allResources)].sort(),
  };
  return {
    ...body,
    evidence_digest: `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`,
  };
}

function retryAnchors() {
  return new Map([
    [2, {
      resource_id: "worker-2",
      staging_digest: retryStagingDigest,
      event_digest: retryEventDigest,
    }],
  ]);
}

function event(type: RemoteLifecycleEvent["type"], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: 1, run_id: runId, type, ...overrides });
}

function signedWorkerReceipt(overrides: Partial<Omit<RemoteWorkerReceipt, "signature">> = {}): RemoteWorkerReceipt {
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "worker-event" as const,
    runId,
    attempt: 1,
    resourceId: "worker-1",
    eventDigest: digest,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    workerKeyId: "worker-key",
    ...overrides,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(remoteWorkerReceiptSigningPayload(unsigned), "utf8"),
      workerKeyPair.privateKey,
    ).toString("base64url"),
  };
}

describe("remote lifecycle contract", () => {
  it("completes staging, execution, and cleanup with exact evidence digests", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    const events = [
      event("run.created"),
      event("workspace.staged", { staging_digest: digest }),
      event("run.started"),
      event("run.finished", { status: "passed", exit_code: 0, event_digest: digest }),
      event("teardown.started"),
      event("teardown.completed", {
        cleanup_proof: cleanupProof(),
      }),
    ];

    for (const content of events) {
      expect(machine.apply(parseRemoteLifecycleEvent(content)).status).not.toBe("failed");
    }
    expect(machine.snapshot()).toMatchObject({
      state: "cleaned",
      stagingDigest: digest,
      eventDigest: digest,
      resourceId: "worker-1",
    });
  });

  it("requires authenticated Worker receipts before terminal and cleaned states in secure mode", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), {
      mode: "secure",
      trustedWorkerKeys: { "worker-key": workerPublicKey },
    });
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));

    expect(machine.apply(parseRemoteLifecycleEvent(event("run.finished", {
      status: "passed",
      exit_code: 0,
      event_digest: digest,
    })))).toEqual({
      status: "failed",
      code: "remote.receipt-invalid",
      message: "Remote Worker receipt is required and must be authenticated.",
    });
    expect(machine.snapshot().state).toBe("running");

    const finishedReceipt = signedWorkerReceipt();
    const finished = parseRemoteLifecycleEvent(event("run.finished", {
      status: "passed",
      exit_code: 0,
      event_digest: digest,
      worker_receipt: finishedReceipt,
    }));
    expect(machine.apply(finished)).toEqual({ status: "accepted", state: "finished" });
    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));

    const proof = cleanupProof();
    const cleanupReceipt = signedWorkerReceipt({
      kind: "cleanup-proof",
      eventDigest: proof.event_digest,
      cleanupEvidenceDigest: proof.evidence_digest,
    });
    const tamperedCleanup = { ...cleanupReceipt, cleanupEvidenceDigest: digest };
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: proof,
      worker_receipt: tamperedCleanup,
    })))).toEqual({
      status: "failed",
      code: "remote.receipt-invalid",
      message: "Remote Worker receipt is required and must be authenticated.",
    });
    expect(machine.snapshot().state).toBe("tearing-down");

    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: proof,
      worker_receipt: cleanupReceipt,
    })))).toEqual({ status: "accepted", state: "cleaned" });
  });

  it("rejects execution before workspace staging", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);

    expect(machine.apply(parseRemoteLifecycleEvent(event("run.started")))).toEqual({
      status: "failed",
      code: "remote.transition-invalid",
      message: "Remote lifecycle transition is not allowed.",
    });
  });

  it("makes cancellation and teardown requests idempotent", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));

    expect(machine.apply(parseRemoteLifecycleEvent(event("client.disconnected")))).toMatchObject({ status: "accepted" });
    expect(machine.apply(parseRemoteLifecycleEvent(event("cancel.requested")))).toMatchObject({ status: "accepted" });
    expect(machine.apply(parseRemoteLifecycleEvent(event("cancel.requested")))).toMatchObject({ status: "accepted" });
    expect(machine.snapshot().state).toBe("cancelling");
  });

  it("can tear down when cancellation arrives after staging but before start", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));

    expect(machine.apply(parseRemoteLifecycleEvent(event("client.disconnected")))).toEqual({
      status: "accepted",
      state: "cancelling",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.started")))).toEqual({
      status: "accepted",
      state: "tearing-down",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: cleanupProof(),
    })))).toEqual({ status: "accepted", state: "cleaned" });
  });

  it("rejects oversized retry configuration and out-of-range exit codes", () => {
    expect(() => new RemoteRunMachine(runId, "worker-1", digest, new Map(
      Array.from({ length: 17 }, (_, index) => [index + 2, {
        resource_id: `worker-${index + 2}`,
        staging_digest: digest,
        event_digest: digest,
      }]),
    ), contractOptions)).toThrow(RemoteLifecycleConfigurationError);
    expect(() => parseRemoteLifecycleEvent(event("run.finished", {
      status: "failed",
      exit_code: 256,
      event_digest: digest,
    }))).toThrow(/remote\.event-invalid/);
    expect(() => parseRemoteLifecycleEvent(event("run.finished", {
      status: "failed",
      exit_code: 0,
      event_digest: digest,
    }))).toThrow(/remote\.event-invalid/);
  });

  it("rejects missing or malformed secure Worker configuration at construction", () => {
    expect(() => new RemoteRunMachine(runId, "worker-1", digest, new Map(), {
      mode: "secure",
    } as unknown as RemoteRunOptions)).toThrow(RemoteLifecycleConfigurationError);
    expect(() => new RemoteRunMachine(runId, "worker-1", digest, new Map(), {
      mode: "secure",
      trustedWorkerKeys: {},
    })).toThrow(RemoteLifecycleConfigurationError);
    expect(() => new RemoteRunMachine(runId, "worker-1", digest, new Map(), {
      mode: "unknown",
    } as unknown as RemoteRunOptions)).toThrow(RemoteLifecycleConfigurationError);
  });

  it("requires all cleanup proofs and does not hide incomplete deletion", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    machine.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "failed", exit_code: 1, event_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));

    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: cleanupProof({ deleted: ["credentials", "logs", "workspace"] }),
    })))).toEqual({
      status: "failed",
      code: "remote.cleanup-incomplete",
      message: "Remote teardown did not prove deletion and credential revocation.",
    });
    expect(machine.snapshot().state).toBe("failed");
  });

  it("rejects cleanup evidence bound to another run", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    machine.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "failed", exit_code: 1, event_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));

    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: cleanupProof({ runId: "other-run" }),
    })))).toEqual({
      status: "failed",
      code: "remote.evidence-invalid",
      message: "Remote cleanup evidence is not bound to this run.",
    });
    expect(machine.snapshot().state).toBe("failed");
  });

  it("accepts exact teardown duplicates and rejects changed duplicate evidence", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    machine.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "passed", exit_code: 0, event_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));
    const proof = cleanupProof();

    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", { cleanup_proof: proof })))).toEqual({
      status: "accepted",
      state: "cleaned",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.started")))).toEqual({
      status: "accepted",
      state: "cleaned",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", { cleanup_proof: proof })))).toEqual({
      status: "accepted",
      state: "cleaned",
    });

    const changed = cleanupProof({ resourceId: "worker-2" });
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", { cleanup_proof: changed })))).toEqual({
      status: "failed",
      code: "remote.evidence-invalid",
      message: "Remote cleanup evidence does not match the completed teardown.",
    });
  });

  it("requires the assigned resource and expected event digest", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    expect(machine.apply(parseRemoteLifecycleEvent(event("run.finished", {
      status: "failed",
      exit_code: 1,
      event_digest: `sha256:${"b".repeat(64)}`,
    })))).toEqual({
      status: "failed",
      code: "remote.evidence-invalid",
      message: "Remote event digest does not match the expected receipt.",
    });

    const cleanup = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    cleanup.apply(parseRemoteLifecycleEvent(event("run.created")));
    cleanup.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    cleanup.apply(parseRemoteLifecycleEvent(event("run.started")));
    cleanup.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "passed", exit_code: 0, event_digest: digest })));
    cleanup.apply(parseRemoteLifecycleEvent(event("teardown.started")));
    expect(cleanup.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: cleanupProof({ resourceId: "worker-2" }),
    })))).toEqual({
      status: "failed",
      code: "remote.evidence-invalid",
      message: "Remote cleanup evidence does not match the assigned resource.",
    });
  });

  it("accepts delayed cancellation and disconnect events after terminal transitions", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    machine.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "passed", exit_code: 0, event_digest: digest })));

    expect(machine.apply(parseRemoteLifecycleEvent(event("cancel.requested")))).toEqual({
      status: "accepted",
      state: "finished",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("client.disconnected")))).toEqual({
      status: "accepted",
      state: "finished",
    });
  });

  it("requires cleanup before retry and binds the next attempt to external anchors", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, retryAnchors(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    expect(machine.apply(parseRemoteLifecycleEvent(event("worker.failed", {
      reason: "timeout",
      event_digest: digest,
    })))).toEqual({ status: "accepted", state: "failed" });

    expect(machine.apply(parseRemoteLifecycleEvent(event("retry.requested", {
      attempt: 2,
      resource_id: "worker-2",
      staging_digest: retryStagingDigest,
      event_digest: retryEventDigest,
    })))).toEqual({
      status: "failed",
      code: "remote.transition-invalid",
      message: "Remote lifecycle transition is not allowed.",
    });

    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: cleanupProof(),
    })))).toEqual({ status: "accepted", state: "cleaned" });

    expect(machine.apply(parseRemoteLifecycleEvent(event("retry.requested", {
      attempt: 2,
      resource_id: "worker-2",
      staging_digest: retryStagingDigest,
      event_digest: retryEventDigest,
    })))).toEqual({ status: "accepted", state: "staged" });
    expect(machine.snapshot()).toMatchObject({
      state: "staged",
      attempt: 2,
      stagingDigest: retryStagingDigest,
    });

    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    machine.apply(parseRemoteLifecycleEvent(event("run.finished", {
      status: "passed",
      exit_code: 0,
      event_digest: retryEventDigest,
    })));
    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));
    expect(machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", {
      cleanup_proof: cleanupProof({
        attempt: 2,
        resourceId: "worker-2",
        stagingDigest: retryStagingDigest,
        eventDigest: retryEventDigest,
      }),
    })))).toEqual({ status: "accepted", state: "cleaned" });
    expect(machine.snapshot()).toMatchObject({
      state: "cleaned",
      attempt: 2,
      eventDigest: retryEventDigest,
      resourceId: "worker-2",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("cancel.requested")))).toEqual({
      status: "accepted",
      state: "cleaned",
    });
  });

  it("accepts exact retry duplicates and rejects altered or unanchored retries", () => {
    const machine = new RemoteRunMachine(runId, "worker-1", digest, retryAnchors(), contractOptions);
    machine.apply(parseRemoteLifecycleEvent(event("run.created")));
    machine.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("run.started")));
    machine.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "failed", exit_code: 1, event_digest: digest })));
    machine.apply(parseRemoteLifecycleEvent(event("teardown.started")));
    machine.apply(parseRemoteLifecycleEvent(event("teardown.completed", { cleanup_proof: cleanupProof() })));

    const retry = {
      attempt: 2,
      resource_id: "worker-2",
      staging_digest: retryStagingDigest,
      event_digest: retryEventDigest,
    };
    expect(machine.apply(parseRemoteLifecycleEvent(event("retry.requested", retry)))).toEqual({
      status: "accepted",
      state: "staged",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("retry.requested", retry)))).toEqual({
      status: "accepted",
      state: "staged",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event("retry.requested", {
      ...retry,
      resource_id: "worker-evil",
    })))).toEqual({
      status: "failed",
      code: "remote.evidence-invalid",
      message: "Remote retry request does not match the accepted attempt.",
    });

    const unanchored = new RemoteRunMachine(runId, "worker-1", digest, new Map(), contractOptions);
    unanchored.apply(parseRemoteLifecycleEvent(event("run.created")));
    unanchored.apply(parseRemoteLifecycleEvent(event("workspace.staged", { staging_digest: digest })));
    unanchored.apply(parseRemoteLifecycleEvent(event("run.started")));
    unanchored.apply(parseRemoteLifecycleEvent(event("run.finished", { status: "failed", exit_code: 1, event_digest: digest })));
    unanchored.apply(parseRemoteLifecycleEvent(event("teardown.started")));
    unanchored.apply(parseRemoteLifecycleEvent(event("teardown.completed", { cleanup_proof: cleanupProof() })));
    expect(unanchored.apply(parseRemoteLifecycleEvent(event("retry.requested", retry)))).toEqual({
      status: "failed",
      code: "remote.evidence-invalid",
      message: "Remote retry attempt is not externally anchored.",
    });
  });

  it.each([
    ["raw artifact", { artifact: "content" }],
    ["invalid digest", { staging_digest: "not-a-digest" }],
    ["raw token", { token: "secret" }],
  ])("rejects %s from lifecycle events", (_label, override) => {
    const content = event("workspace.staged", { staging_digest: digest, ...override });

    expect(() => parseRemoteLifecycleEvent(content)).toThrow(/remote\.event-invalid/);
  });
});
