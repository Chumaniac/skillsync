import { describe, expect, expectTypeOf, it } from "vitest";

import {
  parseProviderRunRequest,
  parseProviderRunResult,
  parseRemoteRunRequest,
  parseRuntimeExecutionResult,
  type ProviderRunRequest,
} from "../../src/sandbox/runtime-ports";

const digest = `sha256:${"a".repeat(64)}`;
const otherDigest = `sha256:${"b".repeat(64)}`;

function providerRunRequest() {
  return {
    runId: "provider-run-1",
    attempt: 1,
    skillDigest: digest,
    inputDigest: otherDigest,
    policyDigest: digest,
    imageDigest: otherDigest,
    adapterId: "reference-adapter",
    adapterVersion: "1.2.3",
    provider: "reference-provider",
    providerVersion: "2.3.4",
    credentialContract: {
      schemaVersion: 1,
      adapterId: "reference-adapter",
      provider: "reference-provider",
      credentials: [
        {
          name: "REFERENCE_TOKEN",
          reference: "secret://provider/reference-token",
          scopes: ["inference"],
          maxTtlSeconds: 900,
          revocation: "required",
        },
      ],
    },
    egressPolicy: {
      mode: "allowlist",
      allowedHosts: ["api.example.test"],
    },
    timeoutMs: 60_000,
    maxOutputBytes: 16_384,
  };
}

function providerRunResult() {
  return {
    events: [
      {
        protocol: "skillsync.runner.v1",
        runId: "provider-run-1",
        seq: 0,
        atMs: 0,
        type: "run.started",
        payload: {
          agent: "reference-agent",
          skillPath: "skills/reference",
          inputDigest: otherDigest,
        },
      },
      {
        protocol: "skillsync.runner.v1",
        runId: "provider-run-1",
        seq: 1,
        atMs: 1,
        type: "run.finished",
        payload: {
          status: "passed",
          exitCode: 0,
        },
      },
    ],
    terminalStatus: "passed",
    eventDigest: digest,
    redactedEvidenceDigest: otherDigest,
    teardown: {
      completed: true,
      resourceId: "provider-run-1",
    },
    evidenceMode: "local-docker",
  };
}

function remoteRunRequest() {
  return {
    runId: "remote-run-1",
    attempt: 2,
    resourceId: "worker-1",
    skillDigest: digest,
    inputDigest: otherDigest,
    policyDigest: digest,
    imageDigest: otherDigest,
    credentialContractReference: "secret://provider/reference-contract",
    egressPolicyReference: "policy://egress/reference",
  };
}

describe("runtime ports", () => {
  it("parses provider run requests with digests and external credential references only", () => {
    const parsed = parseProviderRunRequest(providerRunRequest());

    expectTypeOf(parsed).toEqualTypeOf<ProviderRunRequest | null>();
    expect(parsed).toMatchObject({
      runId: "provider-run-1",
      adapterId: "reference-adapter",
      credentialContract: {
        credentials: [{ reference: "secret://provider/reference-token" }],
      },
      egressPolicy: {
        allowedHosts: ["api.example.test"],
      },
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    if (parsed !== null) {
      expectTypeOf(parsed.credentialContract.credentials).toMatchTypeOf<readonly unknown[]>();
      expectTypeOf(parsed.credentialContract.credentials[0]!.scopes).toMatchTypeOf<readonly string[]>();
      expectTypeOf(parsed.egressPolicy.allowedHosts).toMatchTypeOf<readonly string[]>();
    }
  });

  it.each([
    ["raw value", { value: "secret-token" }],
    ["token", { token: "secret-token" }],
    ["environment value", { envValue: "secret-token" }],
  ])("rejects provider requests with %s fields", (_label, extra) => {
    const value = providerRunRequest();
    Object.assign(value.credentialContract.credentials[0]!, extra);

    expect(parseProviderRunRequest(value)).toBeNull();
  });

  it("parses bounded provider results and rejects unknown evidence modes", () => {
    expect(parseProviderRunResult(providerRunResult())).toMatchObject({
      terminalStatus: "passed",
      evidenceMode: "local-docker",
    });

    const invalid = providerRunResult();
    invalid.evidenceMode = "hybrid-runtime";
    expect(parseProviderRunResult(invalid)).toBeNull();
  });

  it("accepts remote run requests with only digests and external references", () => {
    expect(parseRemoteRunRequest(remoteRunRequest())).toMatchObject({
      resourceId: "worker-1",
      credentialContractReference: "secret://provider/reference-contract",
      egressPolicyReference: "policy://egress/reference",
    });

    const invalid = remoteRunRequest() as Record<string, unknown>;
    invalid.credentialContract = providerRunRequest().credentialContract;
    expect(parseRemoteRunRequest(invalid)).toBeNull();
  });

  it("parses runtime execution results with either a result or a gating finding", () => {
    expect(parseRuntimeExecutionResult({
      status: "passed",
      evidenceMode: "local-docker",
      result: providerRunResult(),
    })).toMatchObject({
      status: "passed",
      evidenceMode: "local-docker",
    });

    expect(parseRuntimeExecutionResult({
      status: "blocked",
      evidenceMode: "remote-worker",
      finding: {
        code: "runtime.attestation-invalid",
        status: "fail",
        message: "Runtime activation policy is not configured.",
      },
    })).toMatchObject({
      status: "blocked",
      finding: { code: "runtime.attestation-invalid" },
    });
  });

  it("rejects runtime execution results when nested and top-level evidence modes differ", () => {
    expect(parseRuntimeExecutionResult({
      status: "passed",
      evidenceMode: "offline-simulated",
      result: providerRunResult(),
    })).toBeNull();
  });
});
