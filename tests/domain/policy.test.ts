import { describe, expect, it } from "vitest";

import { evaluatePolicy, type Policy } from "../../src/domain/policy";
import type { Finding } from "../../src/domain/result";

function policy(failOn: string[]): Policy {
  return {
    schema_version: 1,
    fail_on: failOn,
    targets: { required: ["codex"] },
    capabilities: {
      shell: { default: "review" },
      network: { default: "deny" },
    },
    sources: {
      allowed_hosts: ["github.com"],
      require_resolved_commit: true,
    },
    reporting: {
      sarif: true,
      include_local_paths: false,
    },
  };
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    level: 1,
    severity: "warn",
    status: "warn",
    code: "provenance.local-only",
    skill: "review",
    message: "local-only",
    evidence: [],
    ...overrides,
  };
}

describe("evaluatePolicy", () => {
  it("does not block a warning-only result by default", () => {
    const result = evaluatePolicy([finding({})], policy(["structure-error"]));

    expect(result.exitCode).toBe(0);
  });

  it("blocks compatibility loss for a required target", () => {
    const result = evaluatePolicy(
      [
        finding({
          code: "compatibility.unsupported-feature",
          status: "fail",
          severity: "error",
          target: "codex",
        }),
      ],
      policy(["compatibility-loss:required-target"]),
    );

    expect(result.exitCode).toBe(1);
  });

  it("can promote unknown provenance to a blocking result", () => {
    const result = evaluatePolicy(
      [finding({ code: "provenance.unknown-source", status: "unknown" })],
      policy(["unknown-provenance"]),
    );

    expect(result.exitCode).toBe(1);
  });

  it("returns configuration exit code 2 for an invalid policy", () => {
    const result = evaluatePolicy([], { schema_version: 2 } as unknown as Policy);

    expect(result.exitCode).toBe(2);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "policy.invalid", status: "fail" }),
    );
  });
});
