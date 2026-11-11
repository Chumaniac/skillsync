import { describe, expect, it } from "vitest";

import { evaluateRuntimeActivationReadiness } from "../../src/sandbox/runtime-readiness";

describe("runtime activation readiness", () => {
  it("blocks missing deployment policy and controlled-environment evidence", () => {
    expect(evaluateRuntimeActivationReadiness({
      liveCapabilitiesEnabled: false,
      deploymentPolicyConfigured: false,
      controlledEnvironmentVerified: false,
      liveEndpointConfigured: false,
      remoteWorkerRequested: false,
      remoteReceiptAuthenticated: false,
    })).toEqual({
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: [
        "deployment-policy-missing",
        "controlled-environment-unverified",
      ],
    });
  });

  it("blocks live endpoint configuration and remote readiness without an authenticated receipt", () => {
    expect(evaluateRuntimeActivationReadiness({
      liveCapabilitiesEnabled: false,
      deploymentPolicyConfigured: true,
      controlledEnvironmentVerified: true,
      liveEndpointConfigured: true,
      remoteWorkerRequested: true,
      remoteReceiptAuthenticated: false,
    })).toEqual({
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: [
        "live-endpoint-configured",
        "remote-receipt-missing",
      ],
    });
  });

  it("never treats live mode as prepared", () => {
    expect(evaluateRuntimeActivationReadiness({
      liveCapabilitiesEnabled: true,
      deploymentPolicyConfigured: true,
      controlledEnvironmentVerified: true,
      liveEndpointConfigured: false,
      remoteWorkerRequested: false,
      remoteReceiptAuthenticated: false,
    })).toEqual({
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["live-capabilities-enabled"],
    });
  });

  it("reports prepared only for the offline non-live canary posture", () => {
    expect(evaluateRuntimeActivationReadiness({
      liveCapabilitiesEnabled: false,
      deploymentPolicyConfigured: true,
      controlledEnvironmentVerified: true,
      liveEndpointConfigured: false,
      remoteWorkerRequested: true,
      remoteReceiptAuthenticated: true,
    })).toEqual({
      code: "runtime.readiness-prepared",
      status: "pass",
      authoritative: false,
      reasons: [],
    });
  });

  it("fails closed for malformed or unknown readiness input", () => {
    expect(evaluateRuntimeActivationReadiness({ liveCapabilitiesEnabled: false })).toEqual({
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["readiness-input-invalid"],
    });
    expect(evaluateRuntimeActivationReadiness({
      liveCapabilitiesEnabled: false,
      deploymentPolicyConfigured: true,
      controlledEnvironmentVerified: true,
      liveEndpointConfigured: false,
      remoteWorkerRequested: false,
      remoteReceiptAuthenticated: false,
      unexpected: true,
    })).toEqual({
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["readiness-input-invalid"],
    });
  });
});
