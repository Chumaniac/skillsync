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
  createRuntimeActivationBoundary,
  type RuntimeActivationBoundary,
} from "../../src/sandbox/runtime-activation-boundary";
import {
  parseProviderRunRequest,
  type ProviderAdapterPort,
  type ProviderRunRequest,
  type ProviderRunResult,
} from "../../src/sandbox/runtime-ports";
import {
  runLiveRuntime,
  runSimulatedRuntime,
  type RuntimeOrchestratorPorts,
  type RuntimeOrchestratorRequest,
} from "../../src/sandbox/runtime-orchestrator";
import { createReferenceProviderAdapter } from "../../src/sandbox/reference-provider-adapter";

const digest = `sha256:${"a".repeat(64)}`;
const contextDigest = `sha256:${"c".repeat(64)}`;
const issuedAt = "2026-08-05T00:00:00.000Z";
const expiresAt = "2099-08-06T00:00:00.000Z";

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
const policyBundle: Omit<RuntimeTrustPolicyBundle, "signature"> = {
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
  ...policyBundle,
  signature: sign(
    null,
    Buffer.from(runtimeTrustPolicyBundleSigningPayload(policyBundle), "utf8"),
    root.privateKey,
  ).toString("base64url"),
}), { keyId: "runtime-root", publicKeyPem: root.publicKey }, new Date("2026-08-05T12:00:00.000Z"));
if (trustedPolicy === null) {
  throw new Error("orchestrator test policy did not validate");
}

function activationInput(
  capability: RuntimeCapability = "egress",
  activatedCapabilities: RuntimeCapability[] = [],
  context = contextDigest,
  expires = expiresAt,
): RuntimeCapabilityGateInput {
  const artifacts = { imageDigest: digest, policyDigest: digest, runnerContract: "1" as const };
  const evidence = computeRuntimeEvidenceDigest({
    capability,
    contextDigest: context,
    activatedCapabilities,
    artifacts,
  });
  const makeAttestation = (kind: RuntimeAttestation["kind"], signer: "review" | "environment") => {
    const unsigned = {
      schemaVersion: 1 as const,
      kind,
      capability,
      evidenceDigest: evidence,
      issuedAt,
      expiresAt: expires,
      signerKeyId: signer === "review" ? "review-key" : "environment-key",
    };
    return {
      ...unsigned,
      signature: sign(
        null,
        Buffer.from(runtimeAttestationSigningPayload(unsigned), "utf8"),
        signer === "review" ? review.privateKey : environment.privateKey,
      ).toString("base64url"),
    } as RuntimeAttestation;
  };
  const makeReceipt = (capabilityValue: RuntimeCapability): RuntimeActivationReceipt => {
    const unsigned = {
      schemaVersion: 1 as const,
      kind: "activation-receipt" as const,
      capability: capabilityValue,
      contextDigest: context,
      issuedAt,
      expiresAt: expires,
      signerKeyId: "activation-key",
    };
    return {
      ...unsigned,
      signature: sign(
        null,
        Buffer.from(runtimeActivationReceiptSigningPayload(unsigned), "utf8"),
        activation.privateKey,
      ).toString("base64url"),
    };
  };
  return {
    schemaVersion: 1,
    capability,
    contextDigest: context,
    activationReceipts: activatedCapabilities.map(makeReceipt),
    reviewAttestation: makeAttestation("security-review", "review"),
    environmentAttestation: makeAttestation("controlled-environment", "environment"),
    artifacts,
  };
}

function providerRequest(): ProviderRunRequest {
  const request = {
    runId: "provider-run-1",
    attempt: 1,
    skillDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    inputDigest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    policyDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    adapterId: "reference",
    adapterVersion: "1.0.0",
    provider: "reference-agent",
    providerVersion: "0.1.0",
    credentialContract: {
      schemaVersion: 1,
      adapterId: "reference",
      provider: "reference-agent",
      credentials: [{
        name: "REFERENCE_TOKEN",
        reference: "secret://provider/reference-token",
        scopes: ["inference"],
        maxTtlSeconds: 900,
        revocation: "required" as const,
      }],
    },
    egressPolicy: { mode: "allowlist" as const, allowedHosts: ["api.example.test"] },
    timeoutMs: 60_000,
    maxOutputBytes: 16_384,
  };
  const parsed = parseProviderRunRequest(request);
  if (parsed === null) {
    throw new Error("orchestrator provider request did not validate");
  }
  return parsed;
}

function orchestrationRequest(
  activationValue: RuntimeCapabilityGateInput = activationInput(),
  signal?: AbortSignal,
): RuntimeOrchestratorRequest {
  return {
    providerRequest: providerRequest(),
    activationInput: activationValue,
    ...(signal === undefined ? {} : { signal }),
  };
}

function liveResult(request: ProviderRunRequest, evidenceMode: ProviderRunResult["evidenceMode"] = "local-docker"): ProviderRunResult {
  return {
    events: [{
      protocol: "skillsync.runner.v1",
      runId: request.runId,
      seq: 0,
      atMs: 0,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    }],
    terminalStatus: "passed",
    eventDigest: digest,
    redactedEvidenceDigest: digest,
    teardown: { completed: true, resourceId: request.runId },
    evidenceMode,
  };
}

function livePorts(run: ProviderAdapterPort, simulatedProvider = createReferenceProviderAdapter()): RuntimeOrchestratorPorts {
  return { simulatedProvider, liveProvider: run };
}

function trustedBoundary(): RuntimeActivationBoundary {
  return createRuntimeActivationBoundary({
    trustPolicy: trustedPolicy,
    rootKeyId: "runtime-root",
    rootFingerprint: digest,
  });
}

describe("runtime orchestrator", () => {
  it("runs the deterministic provider simulator without touching the live port", async () => {
    const request = orchestrationRequest();
    let liveCalls = 0;
    const ports = livePorts({
      async run() {
        liveCalls += 1;
        throw new Error("live port must not be selected by simulation");
      },
    });

    const result = await runSimulatedRuntime(request, ports);

    expect(result.evidenceMode).toBe("offline-simulated");
    expect(result.terminalStatus).toBe("passed");
    expect(liveCalls).toBe(0);
  });

  it.each([
    ["absent", null, activationInput()],
    ["untrusted", {
      authorize: () => ({
        code: "runtime.activation-approved" as const,
        status: "pass" as const,
        message: "forged",
      }),
      isEnabled: () => true,
    }, activationInput()],
    ["out-of-order", trustedBoundary(), activationInput("remote-worker")],
    ["expired", trustedBoundary(), activationInput("egress", [], contextDigest, "2026-08-05T00:00:00.000Z")],
  ] as const)("blocks live execution for a %s boundary without calling a port", async (_label, boundary, activationValue) => {
    let liveCalls = 0;
    const ports = livePorts({
      async run() {
        liveCalls += 1;
        return liveResult(providerRequest());
      },
    });

    const result = await runLiveRuntime(
      orchestrationRequest(activationValue),
      ports,
      boundary as RuntimeActivationBoundary | null,
    );

    expect(result).toMatchObject({ status: "blocked", evidenceMode: "offline-simulated" });
    expect(result.finding?.status).toBe("fail");
    expect(liveCalls).toBe(0);
  });

  it("binds the live call to the already-authorized activation context", async () => {
    const boundary = trustedBoundary();
    const calls: { request: ProviderRunRequest; signal: AbortSignal }[] = [];
    const controller = new AbortController();
    const ports = livePorts({
      async run(request, signal) {
        calls.push({ request, signal });
        return liveResult(request);
      },
    });

    const result = await runLiveRuntime(orchestrationRequest(activationInput(), controller.signal), ports, boundary);

    expect(result).toMatchObject({ status: "passed", evidenceMode: "local-docker" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.runId).toBe("provider-run-1");
    expect(calls[0]?.signal).toBe(controller.signal);
  });

  it("rejects a later live call whose activation context differs", async () => {
    const boundary = trustedBoundary();
    let liveCalls = 0;
    const ports = livePorts({
      async run(request) {
        liveCalls += 1;
        return liveResult(request);
      },
    });

    await expect(runLiveRuntime(orchestrationRequest(), ports, boundary))
      .resolves.toMatchObject({ status: "passed" });

    const changedContext = `sha256:${"d".repeat(64)}`;
    const result = await runLiveRuntime(
      orchestrationRequest(activationInput("egress", [], changedContext)),
      ports,
      boundary,
    );

    expect(result).toMatchObject({
      status: "blocked",
      finding: { code: "runtime.activation-input-invalid", status: "fail" },
    });
    expect(liveCalls).toBe(1);
  });

  it("forwards cancellation without falling back to simulation", async () => {
    const controller = new AbortController();
    controller.abort();
    let simulatedCalls = 0;
    let liveSignal: AbortSignal | undefined;
    const ports = livePorts({
      async run(request, signal) {
        liveSignal = signal;
        return { ...liveResult(request), terminalStatus: "blocked" as const };
      },
    }, {
      async run() {
        simulatedCalls += 1;
        return liveResult(providerRequest(), "offline-simulated");
      },
    });

    const result = await runLiveRuntime(orchestrationRequest(activationInput(), controller.signal), ports, trustedBoundary());

    expect(result.status).toBe("blocked");
    expect(liveSignal).toBe(controller.signal);
    expect(simulatedCalls).toBe(0);
  });

  it("redacts an unbounded live result into a bounded gate failure", async () => {
    const unbounded = {
      ...liveResult(providerRequest()),
      extra: "must not escape",
    } as unknown as ProviderRunResult;
    const ports = livePorts({ async run() { return unbounded; } });

    const result = await runLiveRuntime(orchestrationRequest(), ports, trustedBoundary());

    expect(result).toMatchObject({
      status: "blocked",
      evidenceMode: "offline-simulated",
      finding: { status: "fail" },
    });
    expect(JSON.stringify(result)).not.toContain("must not escape");
  });

  it("redacts a live port failure without exposing the thrown value", async () => {
    const ports = livePorts({
      async run() {
        throw new Error("port failure must not escape");
      },
    });

    const result = await runLiveRuntime(orchestrationRequest(), ports, trustedBoundary());

    expect(result).toMatchObject({
      status: "blocked",
      evidenceMode: "offline-simulated",
      finding: { status: "fail" },
    });
    expect(JSON.stringify(result)).not.toContain("port failure must not escape");
  });

  it("does not reinterpret offline evidence returned by the live port", async () => {
    const ports = livePorts({
      async run(request) {
        return liveResult(request, "offline-simulated");
      },
    });

    const result = await runLiveRuntime(orchestrationRequest(), ports, trustedBoundary());

    expect(result.status).toBe("blocked");
    expect(result.evidenceMode).toBe("offline-simulated");
    expect(result.result).toBeUndefined();
  });
});
