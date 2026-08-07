import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  evaluateRuntimeDeploymentRequirements,
  parseRuntimeDeploymentRequirements,
  parseRuntimeDeploymentRequirementsFile,
} from "../../src/sandbox/runtime-deployment-requirements";

const digest = `sha256:${"a".repeat(64)}`;

function entrypoint() {
  return {
    boundary: "runtime-activation-boundary",
    enforcement: "required",
    implementation: "not-enabled",
  };
}

function validRequirements() {
  return {
    schemaVersion: 1,
    source: "deployment-config",
    liveCapabilitiesEnabled: false,
    activation: {
      order: ["egress", "provider-credentials", "docker-microvm", "remote-worker"],
      rootPin: {
        reference: "deployment-key-store://skillsync/runtime-root/primary",
        keyId: "runtime-root-primary",
        fingerprint: digest,
      },
      entrypoints: {
        egress: entrypoint(),
        "provider-credentials": entrypoint(),
        "docker-microvm": entrypoint(),
        "remote-worker": entrypoint(),
      },
    },
    worker: {
      mode: "secure",
      identity: {
        source: "mtls",
        reference: "mtls://skillsync/worker-ca",
      },
      receipt: {
        required: true,
        maxTtlSeconds: 3600,
        cleanupRequired: true,
      },
    },
    controlledEnvironment: {
      runner: "controlled-ci",
      network: "isolated",
      egress: "deny-by-default",
      credentials: "external-reference-only",
      hostMounts: "none",
      docker: {
        daemon: "controlled-ci-only",
        baseImages: "preseeded-only",
        pull: "forbidden",
        socketMount: "forbidden",
        network: "deny",
      },
      microvm: {
        execution: "controlled-ci-only",
        network: "deny-by-default",
        hostMounts: "forbidden",
      },
      publicEvidence: "bounded-redacted",
    },
    rollback: {
      enabled: true,
      target: "existing-fail-closed-backend",
      triggers: ["receipt-missing", "credential-leak", "network-policy-regression"],
    },
  };
}

describe("runtime deployment requirements", () => {
  it("accepts a complete reference-only contract and freezes the result", () => {
    const parsed = parseRuntimeDeploymentRequirements(validRequirements());

    expect(parsed).not.toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.activation)).toBe(true);
    expect(evaluateRuntimeDeploymentRequirements(validRequirements())).toEqual({
      code: "runtime.deployment-requirements-declared",
      status: "pass",
      authoritative: false,
      reasons: [],
    });
  });

  it("parses bounded JSON without reading external state", () => {
    expect(parseRuntimeDeploymentRequirementsFile(JSON.stringify(validRequirements()))).not.toBeNull();
    expect(parseRuntimeDeploymentRequirementsFile("{".repeat(32_769))).toBeNull();
    expect(parseRuntimeDeploymentRequirementsFile("not-json")).toBeNull();
  });

  it("ships a schema and reference-only template without key material", async () => {
    const schema = JSON.parse(await readFile("config/runtime-deployment-requirements.schema.json", "utf8")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const template = await readFile("config/runtime-deployment-requirements.template.json", "utf8");

    expect(schema.required).toEqual(expect.arrayContaining([
      "activation",
      "worker",
      "controlledEnvironment",
      "rollback",
    ]));
    expect(schema.properties.liveCapabilitiesEnabled).toEqual({ const: false });
    expect(template).toContain("deployment-key-store://");
    expect(template).toContain("mtls://");
    expect(template).not.toContain("privateKey");
    expect(template).not.toContain("publicKeyPem");
    expect(template).not.toContain("credentialValue");
  });

  it("rejects live mode and reports a stable blocked reason", () => {
    const input = validRequirements();
    input.liveCapabilitiesEnabled = true;

    expect(parseRuntimeDeploymentRequirements(input)).toBeNull();
    expect(evaluateRuntimeDeploymentRequirements(input)).toMatchObject({
      code: "runtime.deployment-requirements-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["live-capabilities-enabled"],
    });
  });

  it.each([
    ["raw key material", (input: Record<string, unknown>) => { input.privateKey = "pem"; }],
    ["missing entrypoint", (input: Record<string, unknown>) => {
      delete (input.activation as Record<string, unknown>).entrypoints;
    }],
    ["wrong activation order", (input: Record<string, unknown>) => {
      (input.activation as Record<string, unknown>).order = ["remote-worker"];
    }],
    ["contract Worker mode", (input: Record<string, unknown>) => {
      (input.worker as Record<string, unknown>).mode = "contract";
    }],
    ["mismatched Worker identity source", (input: Record<string, unknown>) => {
      const identity = ((input.worker as Record<string, unknown>).identity) as Record<string, unknown>;
      identity.source = "mtls";
      identity.reference = "deployment-key-store://skillsync/worker-key";
    }],
    ["unisolated environment", (input: Record<string, unknown>) => {
      (input.controlledEnvironment as Record<string, unknown>).network = "host";
    }],
    ["host mount", (input: Record<string, unknown>) => {
      (input.controlledEnvironment as Record<string, unknown>).hostMounts = "/tmp";
    }],
    ["reference dot segment", (input: Record<string, unknown>) => {
      const rootPin = ((input.activation as Record<string, unknown>).rootPin) as Record<string, unknown>;
      rootPin.reference = "deployment-key-store://skillsync/../runtime-root";
    }],
    ["duplicate rollback trigger", (input: Record<string, unknown>) => {
      (input.rollback as Record<string, unknown>).triggers = ["credential-leak", "credential-leak"];
    }],
  ])("rejects %s", (_label, mutate) => {
    const input = validRequirements();
    mutate(input);

    expect(parseRuntimeDeploymentRequirements(input)).toBeNull();
    expect(evaluateRuntimeDeploymentRequirements(input)).toMatchObject({
      code: "runtime.deployment-requirements-blocked",
      status: "fail",
      authoritative: false,
    });
  });
});
