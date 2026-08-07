import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  EGRESS_AUDIT_LIMITS,
  evaluateSimulatedEgressDecision,
  parseEgressScenario,
  simulateEgressDecision,
  simulateEgressEvidence,
  type EgressAuditEvidence,
} from "../../src/sandbox/egress-simulator";
import {
  parseEgressProxyDecision,
  type EgressPolicy,
  type EgressRequest,
} from "../../src/sandbox/egress-contract";

type EgressFixture = {
  schema_version: 1;
  scenario: unknown;
  request: EgressRequest;
  policy: EgressPolicy;
  expected_decision: Record<string, unknown>;
  expected_finding: { code: string; status: string };
  expected_digests: {
    request_digest: string;
    decision_digest: string;
    evidence_digest: string;
  };
};

const fixtureNames = [
  "allowed",
  "proxy-unavailable",
  "direct-ip",
  "redirect-revalidation",
  "dns-rebinding",
] as const;

async function readFixture(name: (typeof fixtureNames)[number]): Promise<EgressFixture> {
  const content = await readFile(`fixtures/runtime/egress/${name}.json`, "utf8");
  return JSON.parse(content) as EgressFixture;
}

describe("pure egress simulator", () => {
  it("accepts only the finite checked scenario set and rejects unknown scenarios closed", () => {
    expect(parseEgressScenario("allowed")).toBe("allowed");
    expect(parseEgressScenario("dns-rebinding")).toBe("dns-rebinding");
    expect(() => parseEgressScenario("unknown-scenario")).toThrow(/egress\.decision-invalid/);
  });

  it.each(fixtureNames)("matches the %s conformance fixture", async (name) => {
    const fixture = await readFixture(name);
    const decision = simulateEgressDecision(fixture.request, fixture.scenario);
    const parsedExpected = parseEgressProxyDecision(JSON.stringify(fixture.expected_decision));

    expect(fixture.schema_version).toBe(1);
    expect(decision).toEqual(parsedExpected);
    expect(evaluateSimulatedEgressDecision(fixture.request, fixture.scenario, fixture.policy)).toMatchObject(
      fixture.expected_finding,
    );

    const evidence = simulateEgressEvidence(fixture.request, fixture.scenario);
    expect(evidence).toMatchObject({
      requestDigest: fixture.expected_digests.request_digest,
      decisionDigest: fixture.expected_digests.decision_digest,
      evidenceDigest: fixture.expected_digests.evidence_digest,
    });
  });

  it.each(fixtureNames)("marks %s evidence as offline-simulated", async (name) => {
    const fixture = await readFixture(name);
    const evidence = simulateEgressEvidence(fixture.request, fixture.scenario);

    expect(evidence).toHaveProperty("evidenceMode", "offline-simulated");
    expect(evidence.evidenceMode).toBe("offline-simulated");
  });

  it("produces stable request, decision, and evidence digests", async () => {
    const fixture = await readFixture("allowed");
    const evidence = simulateEgressEvidence(fixture.request, fixture.scenario);
    const repeated = simulateEgressEvidence({ ...fixture.request }, fixture.scenario);
    const normalizedInput = simulateEgressEvidence(
      { ...fixture.request, host: "API.EXAMPLE.COM." },
      fixture.scenario,
    );

    expect(evidence).toMatchObject({
      requestDigest: fixture.expected_digests.request_digest,
      decisionDigest: fixture.expected_digests.decision_digest,
      evidenceDigest: fixture.expected_digests.evidence_digest,
    });
    expect(repeated).toEqual(evidence);
    expect(normalizedInput).toEqual(evidence);
  });

  it("keeps audit evidence bounded and free of request content or credentials", async () => {
    const evidence = simulateEgressEvidence(
      (await readFixture("dns-rebinding")).request,
      "dns-rebinding",
    );
    const serialized = JSON.stringify(evidence);

    expect(evidence.audit.length).toBeLessThanOrEqual(EGRESS_AUDIT_LIMITS.maxRecords);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(EGRESS_AUDIT_LIMITS.maxBytes);
    expect(serialized).not.toMatch(/url|body|header|cookie|token|secret|password|credential/i);
    expect((evidence as EgressAuditEvidence).audit.every((record) => Object.keys(record).length <= 8)).toBe(true);
  });

  it("does not mutate a caller request while normalizing it", async () => {
    const fixture = await readFixture("allowed");
    const request = { ...fixture.request };
    const before = { ...request };

    simulateEgressDecision(request, "allowed");

    expect(request).toEqual(before);
  });
});
