import { createHash } from "node:crypto";

import { z } from "zod";

import {
  EgressDecisionError,
  evaluateEgressDecision,
  normalizeEgressHost,
  parseEgressProxyDecision,
  type EgressFinding,
  type EgressPolicy,
  type EgressProxyDecision,
  type EgressRequest,
} from "./egress-contract.js";

export const EgressScenarioSchema = z.enum([
  "allowed",
  "proxy-unavailable",
  "direct-ip",
  "redirect-revalidation",
  "dns-rebinding",
]);

export type EgressScenario = z.infer<typeof EgressScenarioSchema>;

export const EGRESS_AUDIT_LIMITS = {
  maxRecords: 8,
  maxBytes: 4 * 1024,
} as const;

type EgressAuditScalar = string | number | boolean;

export type EgressAuditRecord = Readonly<Record<string, EgressAuditScalar>>;

export type EgressAuditEvidence = {
  schemaVersion: 1;
  evidenceMode: "offline-simulated";
  scenario: EgressScenario;
  requestDigest: string;
  decisionDigest: string;
  evidenceDigest: string;
  audit: readonly EgressAuditRecord[];
};

type ScenarioDefinition = {
  decision: EgressProxyDecision["decision"];
  proxyStatus: EgressProxyDecision["proxyStatus"];
  resolvedAddresses: readonly string[];
  redirectChain: readonly string[];
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new EgressDecisionError();
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function normalizeRequest(request: EgressRequest): EgressRequest {
  try {
    if (
      typeof request !== "object"
      || request === null
      || typeof request.requestId !== "string"
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId)
      || !Number.isInteger(request.port)
      || request.port < 1
      || request.port > 65_535
      || !["http", "https", "dns"].includes(request.protocol)
    ) {
      throw new EgressDecisionError();
    }

    return {
      requestId: request.requestId,
      host: normalizeEgressHost(request.host),
      port: request.port,
      protocol: request.protocol,
    };
  } catch (error: unknown) {
    if (error instanceof EgressDecisionError) {
      throw error;
    }
    throw new EgressDecisionError();
  }
}

export function parseEgressScenario(input: unknown): EgressScenario {
  const result = EgressScenarioSchema.safeParse(input);
  if (!result.success) {
    throw new EgressDecisionError();
  }
  return result.data;
}

function scenarioDefinition(scenario: EgressScenario, request: EgressRequest): ScenarioDefinition {
  switch (scenario) {
    case "allowed":
      return {
        decision: "allowed",
        proxyStatus: "available",
        resolvedAddresses: ["203.0.113.10"],
        redirectChain: [],
      };
    case "proxy-unavailable":
      return {
        decision: "blocked",
        proxyStatus: "unavailable",
        resolvedAddresses: [],
        redirectChain: [],
      };
    case "direct-ip":
      return {
        decision: "allowed",
        proxyStatus: "available",
        resolvedAddresses: [request.host],
        redirectChain: [],
      };
    case "redirect-revalidation":
      return {
        decision: "allowed",
        proxyStatus: "available",
        resolvedAddresses: ["203.0.113.10"],
        redirectChain: ["other.example.com"],
      };
    case "dns-rebinding":
      return {
        decision: "blocked",
        proxyStatus: "available",
        resolvedAddresses: ["203.0.113.10", "127.0.0.1"],
        redirectChain: [],
      };
  }
}

export function simulateEgressDecision(
  request: EgressRequest,
  scenario: unknown,
): EgressProxyDecision {
  const normalizedRequest = normalizeRequest(request);
  const normalizedScenario = parseEgressScenario(scenario);
  const definition = scenarioDefinition(normalizedScenario, normalizedRequest);

  return parseEgressProxyDecision(JSON.stringify({
    schema_version: 1,
    request_id: normalizedRequest.requestId,
    requested_host: normalizedRequest.host,
    port: normalizedRequest.port,
    protocol: normalizedRequest.protocol,
    decision: definition.decision,
    enforcement: "proxy",
    proxy_status: definition.proxyStatus,
    resolved_addresses: [...definition.resolvedAddresses],
    redirect_chain: [...definition.redirectChain],
  }));
}

export function evaluateSimulatedEgressDecision(
  request: EgressRequest,
  scenario: unknown,
  policy: EgressPolicy,
): EgressFinding {
  return evaluateEgressDecision(request, simulateEgressDecision(request, scenario), policy);
}

function auditFor(
  scenario: EgressScenario,
  request: EgressRequest,
  decision: EgressProxyDecision,
): readonly EgressAuditRecord[] {
  switch (scenario) {
    case "allowed":
      return [{
        event: "proxy-decision",
        requestedHost: request.host,
        decision: decision.decision,
        proxyStatus: decision.proxyStatus,
        addressCount: decision.resolvedAddresses.length,
        redirectCount: decision.redirectChain.length,
      }];
    case "proxy-unavailable":
      return [{
        event: "proxy-unavailable",
        requestedHost: request.host,
        decision: decision.decision,
        proxyStatus: decision.proxyStatus,
      }];
    case "direct-ip":
      return [{
        event: "direct-ip-blocked",
        requestedHost: request.host,
        decision: decision.decision,
        proxyStatus: decision.proxyStatus,
        addressCount: decision.resolvedAddresses.length,
      }];
    case "redirect-revalidation":
      return [{
        event: "redirect-revalidated",
        requestedHost: request.host,
        redirectTarget: decision.redirectChain[0] ?? "",
        decision: decision.decision,
        proxyStatus: decision.proxyStatus,
      }];
    case "dns-rebinding":
      return [{
        event: "dns-rebinding-blocked",
        requestedHost: request.host,
        decision: decision.decision,
        proxyStatus: decision.proxyStatus,
        addressCount: decision.resolvedAddresses.length,
        initialAddress: decision.resolvedAddresses[0] ?? "",
        revalidatedAddress: decision.resolvedAddresses[1] ?? "",
      }];
  }
}

export function simulateEgressEvidence(
  request: EgressRequest,
  scenario: unknown,
): EgressAuditEvidence {
  const normalizedRequest = normalizeRequest(request);
  const normalizedScenario = parseEgressScenario(scenario);
  const decision = simulateEgressDecision(normalizedRequest, normalizedScenario);
  const audit = auditFor(normalizedScenario, normalizedRequest, decision);
  const auditBytes = Buffer.byteLength(canonicalJson(audit), "utf8");
  if (audit.length > EGRESS_AUDIT_LIMITS.maxRecords || auditBytes > EGRESS_AUDIT_LIMITS.maxBytes) {
    throw new EgressDecisionError();
  }

  const requestDigest = digest(normalizedRequest);
  const decisionDigest = digest(decision);
  const body = {
    schemaVersion: 1 as const,
    evidenceMode: "offline-simulated" as const,
    scenario: normalizedScenario,
    requestDigest,
    decisionDigest,
    audit: [...audit],
  };
  if (Buffer.byteLength(canonicalJson(body), "utf8") > EGRESS_AUDIT_LIMITS.maxBytes) {
    throw new EgressDecisionError();
  }
  return {
    ...body,
    evidenceDigest: digest(body),
  };
}
