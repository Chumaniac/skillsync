import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  computeCleanupEvidenceDigest,
  parseRemoteLifecycleEvent,
  RemoteRunMachine,
  type CleanupProof,
  type RemoteLifecycleEvent,
} from "../../src/sandbox/remote-contract";
import {
  computeRemoteEventDigest,
  createRemoteWorkerSimulator,
  parseRemoteResource,
  parseRemoteRunRequest,
  verifyRemoteWorkerSimulationReceipt,
  type RemoteResource,
  type RemoteRunRequest,
  type RemoteWorkerPort,
} from "../../src/sandbox/remote-worker-port";
import {
  remoteWorkerReceiptSigningPayload,
  type RemoteWorkerReceipt,
} from "../../src/sandbox/remote-receipt";

type RemoteFixture = {
  schemaVersion: 1;
  request: RemoteRunRequest;
  expectedEventDigest: string;
  expectedLifecycle: string[];
};

const allResources = ["artifacts", "credentials", "logs", "workspace"] as const;
const workerKeyPair = generateKeyPairSync("ed25519");
const workerPublicKey = workerKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

async function readFixture(): Promise<RemoteFixture> {
  const content = await readFile("fixtures/runtime/remote-worker/reference-lifecycle.json", "utf8");
  return JSON.parse(content) as RemoteFixture;
}

function cleanupProof(request: RemoteRunRequest, deleted: readonly string[] = allResources): CleanupProof {
  const body = {
    attempt: request.attempt,
    run_id: request.runId,
    resource_id: request.resourceId,
    staging_digest: request.stagingDigest,
    event_digest: computeRemoteEventDigest(request),
    deleted: [...deleted].sort(),
  };
  return {
    ...body,
    evidence_digest: computeCleanupEvidenceDigest(body),
  };
}

function event(
  runId: string,
  type: RemoteLifecycleEvent["type"],
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({ schema_version: 1, run_id: runId, type, ...overrides });
}

function signedReceipt(
  request: RemoteRunRequest,
  overrides: Partial<Omit<RemoteWorkerReceipt, "signature">> = {},
): RemoteWorkerReceipt {
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "worker-event" as const,
    runId: request.runId,
    attempt: request.attempt,
    resourceId: request.resourceId,
    eventDigest: computeRemoteEventDigest(request),
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

function applyLifecycle(machine: RemoteRunMachine, events: readonly RemoteLifecycleEvent[]): void {
  for (const lifecycleEvent of events) {
    expect(machine.apply(lifecycleEvent).status).not.toBe("failed");
  }
}

describe("offline remote Worker port", () => {
  it("implements the exact digest-only port and produces deterministic contract lifecycle evidence", async () => {
    const fixture = await readFixture();
    const simulator = createRemoteWorkerSimulator();
    expectTypeOf(simulator).toMatchTypeOf<RemoteWorkerPort>();
    expect(parseRemoteRunRequest(fixture.request)).not.toBeNull();

    const resource = await simulator.provision(fixture.request);
    expectTypeOf(resource).toEqualTypeOf<RemoteResource>();
    expect(parseRemoteResource(resource)).toEqual(resource);
    expect(resource).toEqual({
      runId: fixture.request.runId,
      attempt: fixture.request.attempt,
      resourceId: fixture.request.resourceId,
      stagingDigest: fixture.request.stagingDigest,
    });

    const first = await simulator.execute(resource, fixture.request, new AbortController().signal);
    const second = await simulator.execute(resource, fixture.request, new AbortController().signal);
    expect(first).toEqual(second);
    expect(first.map((lifecycleEvent) => lifecycleEvent.type)).toEqual(fixture.expectedLifecycle);
    expect(first.find((lifecycleEvent) => lifecycleEvent.type === "run.finished")).toMatchObject({
      event_digest: fixture.expectedEventDigest,
    });

    const machine = new RemoteRunMachine(
      fixture.request.runId,
      fixture.request.resourceId,
      fixture.expectedEventDigest,
      new Map(),
      { mode: "contract" },
    );
    applyLifecycle(machine, first);
    expect(machine.apply(await simulator.teardown(resource))).toEqual({
      status: "accepted",
      state: "cleaned",
    });
  });

  it("does not let a secure-mode simulation claim authenticated Worker evidence", async () => {
    const fixture = await readFixture();
    const request = { ...fixture.request, mode: "secure" as const };
    const simulator = createRemoteWorkerSimulator();
    const resource = await simulator.provision(request);
    const events = await simulator.execute(resource, request, new AbortController().signal);
    const finished = events.find((lifecycleEvent) => lifecycleEvent.type === "run.finished");
    expect(finished).toBeDefined();
    expect(finished).not.toHaveProperty("worker_receipt");

    const machine = new RemoteRunMachine(
      request.runId,
      request.resourceId,
      computeRemoteEventDigest(request),
      new Map(),
      { mode: "secure", trustedWorkerKeys: { "worker-key": workerPublicKey } },
    );
    applyLifecycle(machine, events.slice(0, 3));
    expect(machine.apply(parseRemoteLifecycleEvent(JSON.stringify(finished)))).toEqual({
      status: "failed",
      code: "remote.receipt-invalid",
      message: "Remote Worker receipt is required and must be authenticated.",
    });
  });

  it("rejects stale authenticated completion receipts", async () => {
    const fixture = await readFixture();
    const request = fixture.request;
    const machine = new RemoteRunMachine(
      request.runId,
      request.resourceId,
      computeRemoteEventDigest(request),
      new Map(),
      { mode: "secure", trustedWorkerKeys: { "worker-key": workerPublicKey } },
    );
    applyLifecycle(machine, [
      parseRemoteLifecycleEvent(event(request.runId, "run.created")),
      parseRemoteLifecycleEvent(event(request.runId, "workspace.staged", { staging_digest: request.stagingDigest })),
      parseRemoteLifecycleEvent(event(request.runId, "run.started")),
    ]);

    const stale = signedReceipt(request, {
      issuedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:01:00.000Z",
    });
    const staleEvent = parseRemoteLifecycleEvent(event(request.runId, "run.finished", {
      status: "passed",
      exit_code: 0,
      event_digest: computeRemoteEventDigest(request),
      worker_receipt: stale,
    }));
    expect(verifyRemoteWorkerSimulationReceipt(staleEvent, stale, {
      attempt: request.attempt,
      resourceId: request.resourceId,
    }, { "worker-key": workerPublicKey })).toMatchObject({
      code: "remote.receipt-expired",
      status: "fail",
    });
    expect(machine.apply(staleEvent)).toEqual({
      status: "failed",
      code: "remote.receipt-invalid",
      message: "Remote Worker receipt is required and must be authenticated.",
    });
  });

  it("rejects duplicate completion instead of accepting stale terminal evidence", async () => {
    const fixture = await readFixture();
    const request = fixture.request;
    const machine = new RemoteRunMachine(
      request.runId,
      request.resourceId,
      computeRemoteEventDigest(request),
      new Map(),
      { mode: "contract" },
    );
    const finished = parseRemoteLifecycleEvent(event(request.runId, "run.finished", {
      status: "passed",
      exit_code: 0,
      event_digest: computeRemoteEventDigest(request),
    }));
    applyLifecycle(machine, [
      parseRemoteLifecycleEvent(event(request.runId, "run.created")),
      parseRemoteLifecycleEvent(event(request.runId, "workspace.staged", { staging_digest: request.stagingDigest })),
      parseRemoteLifecycleEvent(event(request.runId, "run.started")),
      finished,
    ]);

    expect(machine.apply(finished)).toEqual({
      status: "failed",
      code: "remote.transition-invalid",
      message: "Remote lifecycle transition is not allowed.",
    });
  });

  it("rejects retry-before-cleanup and incomplete cleanup proofs", async () => {
    const fixture = await readFixture();
    const request = fixture.request;
    const retryStagingDigest = `sha256:${"b".repeat(64)}`;
    const retryEventDigest = `sha256:${"c".repeat(64)}`;
    const machine = new RemoteRunMachine(
      request.runId,
      request.resourceId,
      computeRemoteEventDigest(request),
      new Map([[2, {
        resource_id: "worker-2",
        staging_digest: retryStagingDigest,
        event_digest: retryEventDigest,
      }]]),
      { mode: "contract" },
    );
    applyLifecycle(machine, [
      parseRemoteLifecycleEvent(event(request.runId, "run.created")),
      parseRemoteLifecycleEvent(event(request.runId, "workspace.staged", { staging_digest: request.stagingDigest })),
      parseRemoteLifecycleEvent(event(request.runId, "run.started")),
      parseRemoteLifecycleEvent(event(request.runId, "worker.failed", {
        reason: "timeout",
        event_digest: computeRemoteEventDigest(request),
      })),
    ]);

    const retry = parseRemoteLifecycleEvent(event(request.runId, "retry.requested", {
      attempt: 2,
      resource_id: "worker-2",
      staging_digest: retryStagingDigest,
      event_digest: retryEventDigest,
    }));
    expect(machine.apply(retry)).toMatchObject({
      status: "failed",
      code: "remote.transition-invalid",
    });

    expect(machine.apply(parseRemoteLifecycleEvent(event(request.runId, "teardown.started")))).toMatchObject({
      status: "accepted",
      state: "tearing-down",
    });
    expect(machine.apply(parseRemoteLifecycleEvent(event(request.runId, "teardown.completed", {
      cleanup_proof: cleanupProof(request, ["credentials", "logs", "workspace"]),
    })))).toEqual({
      status: "failed",
      code: "remote.cleanup-incomplete",
      message: "Remote teardown did not prove deletion and credential revocation.",
    });
  });

  it("binds cancellation to teardown and returns no terminal Worker claim", async () => {
    const fixture = await readFixture();
    const simulator = createRemoteWorkerSimulator();
    const resource = await simulator.provision(fixture.request);
    const controller = new AbortController();
    controller.abort();

    const events = await simulator.execute(resource, fixture.request, controller.signal);
    expect(events.map((lifecycleEvent) => lifecycleEvent.type)).toEqual([
      "run.created",
      "workspace.staged",
      "run.started",
      "cancel.requested",
      "teardown.started",
    ]);
    expect(events.some((lifecycleEvent) => lifecycleEvent.type === "run.finished")).toBe(false);

    const machine = new RemoteRunMachine(
      fixture.request.runId,
      fixture.request.resourceId,
      fixture.expectedEventDigest,
      new Map(),
      { mode: "contract" },
    );
    applyLifecycle(machine, events);
    expect(machine.apply(await simulator.teardown(resource))).toMatchObject({
      status: "accepted",
      state: "cleaned",
    });
  });

  it("rejects resource and request digest mismatches without fallback", async () => {
    const fixture = await readFixture();
    const simulator = createRemoteWorkerSimulator();
    const resource = await simulator.provision(fixture.request);

    await expect(simulator.execute({ ...resource, stagingDigest: `sha256:${"d".repeat(64)}` }, fixture.request, new AbortController().signal))
      .rejects.toThrow(/remote\.simulator-invalid/);
    await expect(simulator.provision({ ...fixture.request, imageDigest: `sha256:${"d".repeat(64)}` }))
      .rejects.toThrow(/remote\.simulator-invalid/);
  });
});
