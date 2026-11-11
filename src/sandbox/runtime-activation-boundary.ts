import { z } from "zod";

import {
  evaluateRuntimeCapabilityGate,
  type RuntimeCapability,
  type RuntimeCapabilityFinding,
} from "./runtime-capability-gate.js";
import type { RuntimeActivationPolicy } from "./runtime-activation-policy.js";

const ContextSchema = z.object({ contextDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) });

export type RuntimeActivationBoundary = {
  authorize(input: unknown, now?: Date): RuntimeCapabilityFinding;
  isEnabled(capability: RuntimeCapability): boolean;
};

const trustedBoundaries = new WeakSet<object>();

function invalidContext(): RuntimeCapabilityFinding {
  return {
    code: "runtime.activation-input-invalid",
    status: "fail",
    message: "Runtime activation input is bound to a different context.",
  };
}

export function createRuntimeActivationBoundary(
  policy: RuntimeActivationPolicy | null,
): RuntimeActivationBoundary {
  const enabled = new Set<RuntimeCapability>();
  let contextDigest: string | undefined;

  const boundary: RuntimeActivationBoundary = Object.freeze({
    authorize(input: unknown, now = new Date()): RuntimeCapabilityFinding {
      if (policy === null) {
        return {
          code: "runtime.attestation-invalid",
          status: "fail",
          message: "Runtime activation policy is not configured.",
        };
      }

      const context = ContextSchema.safeParse(input);
      if (!context.success) {
        return {
          code: "runtime.activation-input-invalid",
          status: "fail",
          message: "Runtime activation input is invalid.",
        };
      }
      if (contextDigest !== undefined && contextDigest !== context.data.contextDigest) {
        return invalidContext();
      }

      const finding = evaluateRuntimeCapabilityGate(input, policy.trustPolicy, now);
      if (finding.status === "pass") {
        contextDigest ??= context.data.contextDigest;
        const capability = typeof input === "object" && input !== null && "capability" in input
          ? input.capability
          : undefined;
        if (typeof capability === "string") {
          enabled.add(capability as RuntimeCapability);
        }
      }
      return finding;
    },
    isEnabled(capability: RuntimeCapability): boolean {
      return enabled.has(capability);
    },
  });
  trustedBoundaries.add(boundary);
  return boundary;
}

function untrustedBoundary(): RuntimeCapabilityFinding {
  return {
    code: "runtime.activation-input-invalid",
    status: "fail",
    message: "Runtime activation boundary is not trusted.",
  };
}

export function authorizeRuntimeActivation(
  boundary: RuntimeActivationBoundary | null | undefined,
  input: unknown,
  now = new Date(),
): RuntimeCapabilityFinding {
  if (boundary === null || boundary === undefined || !trustedBoundaries.has(boundary)) {
    return untrustedBoundary();
  }
  return boundary.authorize(input, now);
}

export type RuntimeActivationExecution<T> = {
  finding: RuntimeCapabilityFinding;
  result?: T;
};

/**
 * Future live adapters should use this wrapper so capability allocation cannot
 * happen before the signed activation boundary has approved the request.
 */
export async function activateRuntimeCapability<T>(
  boundary: RuntimeActivationBoundary | null | undefined,
  input: unknown,
  start: () => T | Promise<T>,
  now = new Date(),
): Promise<RuntimeActivationExecution<T>> {
  const finding = authorizeRuntimeActivation(boundary, input, now);
  if (finding.status === "fail") {
    return { finding };
  }
  return { finding, result: await start() };
}
