import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  evaluateMicrovmContract,
  parseMicrovmContract,
} from "../../src/sandbox/microvm-contract";

async function readFixture(): Promise<Record<string, unknown>> {
  const content = await readFile("fixtures/runtime/microvm/reference-config.json", "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

describe("microVM isolation contract", () => {
  it("parses the reference contract, freezes it, and reports offline contract evidence", async () => {
    const fixture = await readFixture();
    const parsed = parseMicrovmContract(fixture);

    expect(parsed).not.toBeNull();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(evaluateMicrovmContract(fixture)).toMatchObject({
      code: "microvm.contract-valid",
      status: "pass",
      reasons: [],
    });
    expect(JSON.stringify(parsed)).toContain("offline-simulated");
  });

  it.each([
    ["host mounts", (contract: Record<string, unknown>) => { contract.hostMounts = "workspace"; }, "host-mounts-not-empty"],
    ["non-isolated mode", (contract: Record<string, unknown>) => { contract.mode = "shared"; }, "microvm-mode-not-isolated"],
    ["non-preseeded image", (contract: Record<string, unknown>) => {
      const image = contract.image as Record<string, unknown>;
      image.preseeded = false;
    }, "image-not-preseeded"],
    ["network allowlisting", (contract: Record<string, unknown>) => {
      const network = contract.network as Record<string, unknown>;
      network.mode = "allowlist";
    }, "network-not-deny-by-default"],
    ["missing cleanup proof", (contract: Record<string, unknown>) => {
      const teardown = contract.teardown as Record<string, unknown>;
      teardown.cleanupProof = "optional";
    }, "cleanup-proof-required"],
  ] as const)("fails closed on %s", async (_label, mutate, reason) => {
    const fixture = await readFixture();
    const invalid = structuredClone(fixture);
    mutate(invalid);

    expect(parseMicrovmContract(invalid)).toBeNull();
    expect(evaluateMicrovmContract(invalid)).toMatchObject({
      code: "microvm.contract-invalid",
      status: "fail",
      reasons: [reason],
    });
  });

  it.each([
    ["live capability flag", (contract: Record<string, unknown>) => { contract.liveCapabilitiesEnabled = true; }],
    ["unknown field", (contract: Record<string, unknown>) => { contract.unreviewed = true; }],
    ["invalid input", (_contract: Record<string, unknown>) => undefined],
  ] as const)("rejects %s without widening the contract", async (_label, mutate) => {
    const fixture = await readFixture();
    const invalid = _label === "invalid input" ? null : structuredClone(fixture);
    if (invalid !== null) {
      mutate(invalid);
    }

    expect(parseMicrovmContract(invalid)).toBeNull();
    expect(evaluateMicrovmContract(invalid)).toMatchObject({
      code: "microvm.contract-invalid",
      status: "fail",
    });
  });
});
