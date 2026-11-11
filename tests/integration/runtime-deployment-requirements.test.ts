import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  evaluateRuntimeDeploymentRequirements,
  parseRuntimeDeploymentRequirementsFile,
} from "../../src/sandbox/runtime-deployment-requirements";

describe("runtime deployment requirements canary posture", () => {
  it("keeps the checked-in template reference-only and non-authoritative", async () => {
    const template = await readFile("config/runtime-deployment-requirements.template.json", "utf8");
    const input = JSON.parse(template) as Record<string, unknown>;

    expect(input.liveCapabilitiesEnabled).toBe(false);
    expect(parseRuntimeDeploymentRequirementsFile(template)).toBeNull();
    expect(evaluateRuntimeDeploymentRequirements(input)).toMatchObject({
      code: "runtime.deployment-requirements-blocked",
      status: "fail",
      authoritative: false,
    });
  });

  it("blocks a live-capability marker even when no other state is supplied", () => {
    expect(evaluateRuntimeDeploymentRequirements({ liveCapabilitiesEnabled: true })).toEqual({
      code: "runtime.deployment-requirements-blocked",
      status: "fail",
      authoritative: false,
      reasons: ["live-capabilities-enabled"],
    });
  });
});
