import { z } from "zod";

const RuntimeReadinessInputSchema = z.object({
  liveCapabilitiesEnabled: z.boolean(),
  deploymentPolicyConfigured: z.boolean(),
  controlledEnvironmentVerified: z.boolean(),
  liveEndpointConfigured: z.boolean(),
  remoteWorkerRequested: z.boolean(),
  remoteReceiptAuthenticated: z.boolean(),
}).strict();

export type RuntimeReadinessFinding =
  | {
      code: "runtime.readiness-prepared";
      status: "pass";
      authoritative: false;
      reasons: [];
    }
  | {
      code: "runtime.readiness-blocked";
      status: "fail";
      authoritative: false;
      reasons: string[];
    };

export function evaluateRuntimeActivationReadiness(input: unknown): RuntimeReadinessFinding {
  const parsed = RuntimeReadinessInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["readiness-input-invalid"],
    };
  }

  const value = parsed.data;
  if (value.liveCapabilitiesEnabled) {
    return {
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["live-capabilities-enabled"],
    };
  }

  const reasons: string[] = [];
  if (!value.deploymentPolicyConfigured) {
    reasons.push("deployment-policy-missing");
  }
  if (!value.controlledEnvironmentVerified) {
    reasons.push("controlled-environment-unverified");
  }
  if (value.liveEndpointConfigured) {
    reasons.push("live-endpoint-configured");
  }
  if (value.remoteWorkerRequested && !value.remoteReceiptAuthenticated) {
    reasons.push("remote-receipt-missing");
  }
  if (reasons.length > 0) {
    return {
      code: "runtime.readiness-blocked",
      status: "fail",
      authoritative: false,
      reasons,
    };
  }
  return {
    code: "runtime.readiness-prepared",
    status: "pass",
    authoritative: false,
    reasons: [],
  };
}
