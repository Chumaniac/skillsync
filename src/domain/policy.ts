import { z } from "zod";

import type { Finding } from "./result.js";

const PolicySchema = z
  .object({
    schema_version: z.literal(1),
    fail_on: z.array(z.string()),
    targets: z
      .object({
        required: z.array(z.string()),
      })
      .strict(),
    capabilities: z.record(
      z.string(),
      z
        .object({
          default: z.enum(["allow", "review", "deny"]),
        })
        .strict(),
    ),
    sources: z
      .object({
        allowed_hosts: z.array(z.string()),
        require_resolved_commit: z.boolean(),
      })
      .strict(),
    reporting: z
      .object({
        sarif: z.boolean(),
        include_local_paths: z.boolean(),
      })
      .strict(),
  })
  .strict();

export { PolicySchema };
export type Policy = z.infer<typeof PolicySchema>;

function invalidPolicyFinding(error: unknown): Finding {
  const message = error instanceof Error ? error.message : String(error);
  return {
    level: 2,
    severity: "error",
    status: "fail",
    code: "policy.invalid",
    skill: "<policy>",
    message: "Policy configuration is invalid.",
    evidence: [{ error: message.split("\n", 1)[0] ?? "unknown" }],
    remediation: "Fix the policy schema before running verification.",
  };
}

function isRequiredTarget(target: string | undefined, policy: Policy): boolean {
  return Boolean(target && policy.targets.required.includes(target));
}

function isBlocking(finding: Finding, policy: Policy): boolean {
  if (finding.status === "fail" || finding.severity === "critical") {
    if (finding.code.startsWith("compatibility.")) {
      return policy.fail_on.includes("compatibility-loss") ||
        (policy.fail_on.includes("compatibility-loss:required-target") && isRequiredTarget(finding.target, policy));
    }
    if (finding.code.startsWith("structure.")) {
      return policy.fail_on.includes("structure-error") || policy.fail_on.includes("all-errors");
    }
    return policy.fail_on.includes("all-errors") || policy.fail_on.includes(finding.code);
  }

  if (finding.code.startsWith("provenance.") && policy.fail_on.includes("unknown-provenance")) {
    return finding.code === "provenance.unknown-source" || finding.code === "provenance.local-only";
  }

  if (finding.code.startsWith("compatibility.") && policy.fail_on.includes("compatibility-loss:required-target")) {
    return isRequiredTarget(finding.target, policy) && finding.status !== "pass";
  }

  return false;
}

export function evaluatePolicy(
  findings: Finding[],
  policy: unknown,
  inputError?: string,
): { findings: Finding[]; exitCode: 0 | 1 | 2 | 3 | 4; policy?: Policy } {
  const parsed = PolicySchema.safeParse(policy);
  if (!parsed.success) {
    return {
      findings: [...findings, invalidPolicyFinding(inputError ?? parsed.error)],
      exitCode: 2,
    };
  }

  return {
    findings,
    exitCode: findings.some((finding) => isBlocking(finding, parsed.data)) ? 1 : 0,
    policy: parsed.data,
  };
}
