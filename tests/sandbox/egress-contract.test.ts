import { describe, expect, it } from "vitest";

import {
  evaluateEgressDecision,
  parseEgressProxyDecision,
  type EgressPolicy,
  type EgressRequest,
} from "../../src/sandbox/egress-contract";

const request: EgressRequest = {
  requestId: "req-1",
  host: "api.example.com",
  port: 443,
  protocol: "https",
};

const allowlist: EgressPolicy = {
  mode: "allowlist",
  allowedHosts: ["api.example.com"],
};

const validAllowed = JSON.stringify({
  schema_version: 1,
  request_id: "req-1",
  requested_host: "api.example.com",
  port: 443,
  protocol: "https",
  decision: "allowed",
  enforcement: "proxy",
  proxy_status: "available",
  resolved_addresses: ["203.0.113.10"],
  redirect_chain: [],
});

function allowedDecisionWithAddresses(resolvedAddresses: string[]) {
  const value = JSON.parse(validAllowed) as Record<string, unknown>;
  value.resolved_addresses = resolvedAddresses;
  return parseEgressProxyDecision(JSON.stringify(value));
}

describe("egress proxy contract", () => {
  it("accepts bounded proxy decisions without URL or body fields", () => {
    expect(parseEgressProxyDecision(validAllowed)).toMatchObject({
      requestId: "req-1",
      requestedHost: "api.example.com",
      resolvedAddresses: ["203.0.113.10"],
    });
  });

  it.each([
    ["unknown body field", { body: "secret" }],
    ["invalid IP", { resolved_addresses: ["not-an-ip"] }],
    ["shell-like host", { requested_host: "api.example.com;curl" }],
    ["unbounded redirect chain", { redirect_chain: Array.from({ length: 17 }, () => "other.example.com") }],
  ])("rejects %s", (_label, override) => {
    const value = JSON.parse(validAllowed) as Record<string, unknown>;
    Object.assign(value, override);

    expect(() => parseEgressProxyDecision(JSON.stringify(value))).toThrow(/egress\.decision-invalid/);
  });

  it("allows only an explicitly allowlisted host through the proxy", () => {
    const decision = parseEgressProxyDecision(validAllowed);

    expect(evaluateEgressDecision(request, decision, allowlist)).toEqual({
      code: "egress.decision-valid",
      status: "pass",
      message: "Proxy decision matches the egress policy.",
    });
    const unlistedDecision = parseEgressProxyDecision(validAllowed.replace("api.example.com", "other.example.com"));
    expect(evaluateEgressDecision(
      { ...request, host: "other.example.com" },
      unlistedDecision,
      allowlist,
    ).code).toBe("egress.allowlist-mismatch");
  });

  it("keeps the existing documentation address fixture valid", () => {
    expect(evaluateEgressDecision(
      request,
      allowedDecisionWithAddresses(["203.0.113.10"]),
      allowlist,
    )).toMatchObject({ code: "egress.decision-valid", status: "pass" });
  });

  it.each([
    ["IPv4 loopback", ["127.0.0.1"]],
    ["RFC1918 private", ["192.168.1.10"]],
    ["metadata/link-local", ["169.254.169.254"]],
    ["IPv4 unspecified", ["0.0.0.0"]],
    ["IPv4 shared address", ["100.64.0.1"]],
    ["IPv4 benchmark", ["198.18.0.1"]],
    ["IPv4 multicast", ["224.0.0.1"]],
    ["IPv4 reserved", ["240.0.0.1"]],
    ["IPv6 loopback", ["::1"]],
    ["IPv6 unspecified", ["::"]],
    ["IPv6 unique-local", ["fc00::1"]],
    ["IPv6 link-local", ["fe80::1"]],
    ["IPv6 site-local", ["fec0::1"]],
    ["IPv6 multicast", ["ff02::1"]],
    ["IPv4-mapped private", ["::ffff:192.168.1.10"]],
  ])("rejects an allowed decision resolving to %s", (_label, resolvedAddresses) => {
    expect(evaluateEgressDecision(
      request,
      allowedDecisionWithAddresses(resolvedAddresses),
      allowlist,
    )).toMatchObject({ code: "egress.resolved-address-forbidden", status: "fail" });
  });

  it("rejects an allowed decision when any resolution is private", () => {
    expect(evaluateEgressDecision(
      request,
      allowedDecisionWithAddresses(["203.0.113.10", "10.0.0.8"]),
      allowlist,
    )).toMatchObject({ code: "egress.resolved-address-forbidden", status: "fail" });
  });

  it("rejects direct IP, redirect, and deny-policy bypasses", () => {
    const directIp = parseEgressProxyDecision(validAllowed.replace("api.example.com", "203.0.113.10"));
    const redirect = parseEgressProxyDecision(validAllowed.replace('"redirect_chain":[]', '"redirect_chain":["evil.example.com"]'));
    const allowedUnderDeny = parseEgressProxyDecision(validAllowed);

    expect(evaluateEgressDecision({ ...request, host: "203.0.113.10" }, directIp, allowlist).code)
      .toBe("egress.direct-ip-forbidden");
    expect(evaluateEgressDecision(request, redirect, allowlist).code)
      .toBe("egress.redirect-forbidden");
    expect(evaluateEgressDecision(request, allowedUnderDeny, { mode: "deny", allowedHosts: [] }).code)
      .toBe("egress.policy-bypass");
  });

  it("rejects IP addresses from hostname allowlists and redirect chains", () => {
    const ipAllowlist = evaluateEgressDecision(request, parseEgressProxyDecision(validAllowed), {
      mode: "allowlist",
      allowedHosts: ["203.0.113.10"],
    });
    const redirectToIp = JSON.parse(validAllowed) as Record<string, unknown>;
    redirectToIp.redirect_chain = ["203.0.113.11"];

    expect(ipAllowlist).toEqual({
      code: "egress.allowlist-mismatch",
      status: "fail",
      message: "Egress allowlist must contain hostnames, not IP addresses.",
    });
    expect(() => parseEgressProxyDecision(JSON.stringify(redirectToIp))).toThrow(/egress\.decision-invalid/);
  });

  it.each([
    ["request id", { requestId: "req-2" }],
    ["host", { host: "other.example.com" }],
    ["port", { port: 80 }],
    ["protocol", { protocol: "http" as const }],
  ])("rejects a mismatched %s binding field", (_label, override) => {
    const result = evaluateEgressDecision(
      { ...request, ...override },
      parseEgressProxyDecision(validAllowed),
      allowlist,
    );

    expect(result.code).toBe("egress.request-mismatch");
  });

  it("fails closed when the proxy is unavailable", () => {
    const blocked = parseEgressProxyDecision(validAllowed.replace('"allowed"', '"blocked"').replace('"available"', '"unavailable"').replace('"resolved_addresses":["203.0.113.10"]', '"resolved_addresses":[]'));

    expect(evaluateEgressDecision(request, blocked, allowlist)).toEqual({
      code: "egress.proxy-unavailable",
      status: "fail",
      message: "Egress proxy is unavailable; direct network access is forbidden.",
    });
  });
});
