import { isIP } from "node:net";

import { z } from "zod";

const MAX_DECISION_BYTES = 64 * 1024;

const RawDecisionSchema = z
  .object({
    schema_version: z.literal(1),
    request_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    requested_host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    protocol: z.enum(["http", "https", "dns"]),
    decision: z.enum(["allowed", "blocked"]),
    enforcement: z.literal("proxy"),
    proxy_status: z.enum(["available", "unavailable"]),
    resolved_addresses: z.array(z.string().min(1).max(45)).max(8),
    redirect_chain: z.array(z.string().min(1).max(253)).max(16),
  })
  .strict();

export type EgressProtocol = "http" | "https" | "dns";

export type EgressRequest = {
  requestId: string;
  host: string;
  port: number;
  protocol: EgressProtocol;
};

export type EgressPolicy = {
  mode: "deny" | "allowlist";
  allowedHosts: string[];
};

export type EgressProxyDecision = {
  requestId: string;
  requestedHost: string;
  port: number;
  protocol: EgressProtocol;
  decision: "allowed" | "blocked";
  enforcement: "proxy";
  proxyStatus: "available" | "unavailable";
  resolvedAddresses: string[];
  redirectChain: string[];
};

export type EgressFinding =
  | {
      code: "egress.decision-valid";
      status: "pass";
      message: "Proxy decision matches the egress policy.";
    }
  | {
      code:
        | "egress.decision-invalid"
        | "egress.request-mismatch"
        | "egress.allowlist-mismatch"
        | "egress.direct-ip-forbidden"
        | "egress.resolved-address-forbidden"
        | "egress.redirect-forbidden"
        | "egress.policy-bypass"
        | "egress.proxy-unavailable";
      status: "fail";
      message: string;
    };

export class EgressDecisionError extends Error {
  readonly code = "egress.decision-invalid" as const;

  constructor() {
    super("egress.decision-invalid: proxy decision is invalid");
    this.name = "EgressDecisionError";
  }
}

export function normalizeEgressHost(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || normalized.includes("\0")) {
    throw new EgressDecisionError();
  }
  if (isIP(normalized) > 0) {
    return normalized;
  }
  if (
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    normalized.includes("..") ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(normalized)
  ) {
    throw new EgressDecisionError();
  }
  return normalized;
}

function normalizeHostname(input: string): string {
  const normalized = normalizeEgressHost(input);
  if (isIP(normalized) > 0) {
    throw new EgressDecisionError();
  }
  return normalized;
}

function validAddress(value: string): boolean {
  return isIP(value) > 0 && !value.includes("%");
}

type Ipv4Cidr = readonly [network: number, prefixLength: number];
type Ipv6Cidr = readonly [network: bigint, prefixLength: number];

const UNSAFE_IPV4_CIDRS: readonly Ipv4Cidr[] = [
  [0x00000000, 8], // unspecified and "this network"
  [0x0a000000, 8], // RFC1918 private
  [0x64400000, 10], // shared address space
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local and metadata services
  [0xac100000, 12], // RFC1918 private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0a80000, 16], // RFC1918 private
  [0xc6120000, 15], // benchmarking
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved
];

const UNSAFE_IPV6_CIDRS: readonly Ipv6Cidr[] = [
  [0n, 96], // IPv4-compatible, including unspecified and loopback
  [0xfc00n << 112n, 7], // unique-local
  [0xfe80n << 112n, 10], // link-local
  [0xfec0n << 112n, 10], // deprecated site-local
  [0xffn << 120n, 8], // multicast
  [0x100n << 112n, 64], // discard-only
];

function parseIpv4Number(address: string): number | undefined {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return undefined;
  }
  const values = octets.map((octet) => Number(octet));
  if (values.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }
  return (((values[0]! << 24) | (values[1]! << 16) | (values[2]! << 8) | values[3]!) >>> 0);
}

function isInIpv4Cidr(address: number, [network, prefixLength]: Ipv4Cidr): boolean {
  const shift = 32 - prefixLength;
  return (address >>> shift) === (network >>> shift);
}

function isUnsafeIpv4Number(address: number): boolean {
  return UNSAFE_IPV4_CIDRS.some((cidr) => isInIpv4Cidr(address, cidr));
}

function ipv4Groups(address: string): readonly [string, string] | undefined {
  const value = parseIpv4Number(address);
  if (value === undefined) {
    return undefined;
  }
  return [((value >>> 16) & 0xffff).toString(16), (value & 0xffff).toString(16)];
}

function parseIpv6BigInt(address: string): bigint | undefined {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    if (separator < 0) {
      return undefined;
    }
    const groups = ipv4Groups(normalized.slice(separator + 1));
    if (groups === undefined) {
      return undefined;
    }
    normalized = `${normalized.slice(0, separator + 1)}${groups[0]}:${groups[1]}`;
  }

  const compression = normalized.indexOf("::");
  let groups: string[];
  if (compression >= 0) {
    if (normalized.indexOf("::", compression + 2) >= 0) {
      return undefined;
    }
    const left = normalized.slice(0, compression).split(":").filter(Boolean);
    const right = normalized.slice(compression + 2).split(":").filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 1) {
      return undefined;
    }
    groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  } else {
    groups = normalized.split(":");
  }
  if (
    groups.length !== 8
    || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return undefined;
  }
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function isInIpv6Cidr(address: bigint, [network, prefixLength]: Ipv6Cidr): boolean {
  const shift = 128n - BigInt(prefixLength);
  return (address >> shift) === (network >> shift);
}

function isUnsafeResolvedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const value = parseIpv4Number(address);
    return value === undefined || isUnsafeIpv4Number(value);
  }
  if (version !== 6) {
    return true;
  }

  const value = parseIpv6BigInt(address);
  if (value === undefined) {
    return true;
  }
  if ((value >> 32n) === 0xffffn) {
    return isUnsafeIpv4Number(Number(value & 0xffffffffn));
  }
  return UNSAFE_IPV6_CIDRS.some((cidr) => isInIpv6Cidr(value, cidr));
}

export function parseEgressProxyDecision(content: string): EgressProxyDecision {
  if (Buffer.byteLength(content, "utf8") > MAX_DECISION_BYTES) {
    throw new EgressDecisionError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new EgressDecisionError();
  }
  const result = RawDecisionSchema.safeParse(parsed);
  if (!result.success) {
    throw new EgressDecisionError();
  }

  try {
    const requestedHost = normalizeEgressHost(result.data.requested_host);
    const redirectChain = result.data.redirect_chain.map(normalizeHostname);
    if (result.data.resolved_addresses.some((address) => !validAddress(address))) {
      throw new EgressDecisionError();
    }
    return {
      requestId: result.data.request_id,
      requestedHost,
      port: result.data.port,
      protocol: result.data.protocol,
      decision: result.data.decision,
      enforcement: result.data.enforcement,
      proxyStatus: result.data.proxy_status,
      resolvedAddresses: [...result.data.resolved_addresses],
      redirectChain,
    };
  } catch (error: unknown) {
    if (error instanceof EgressDecisionError) {
      throw error;
    }
    throw new EgressDecisionError();
  }
}

function failure(
  code: Exclude<EgressFinding["code"], "egress.decision-valid">,
  message: string,
): EgressFinding {
  return { code, status: "fail", message };
}

export function evaluateEgressDecision(
  request: EgressRequest,
  decision: EgressProxyDecision,
  policy: EgressPolicy,
): EgressFinding {
  let requestHost: string;
  let allowedHosts: string[];
  try {
    requestHost = normalizeEgressHost(request.host);
  } catch {
    return failure("egress.request-mismatch", "Egress request host is not a valid normalized host.");
  }
  try {
    allowedHosts = policy.allowedHosts.map(normalizeHostname);
  } catch {
    return failure("egress.allowlist-mismatch", "Egress allowlist must contain hostnames, not IP addresses.");
  }

  if (
    request.requestId !== decision.requestId ||
    requestHost !== decision.requestedHost ||
    request.port !== decision.port ||
    request.protocol !== decision.protocol
  ) {
    return failure("egress.request-mismatch", "Proxy decision does not bind to the requested network operation.");
  }
  if (decision.enforcement !== "proxy") {
    return failure("egress.policy-bypass", "Network decision was not enforced by the approved proxy.");
  }
  if (decision.proxyStatus === "unavailable") {
    if (decision.decision === "allowed" || decision.resolvedAddresses.length > 0) {
      return failure("egress.policy-bypass", "An unavailable proxy cannot authorize network access.");
    }
    return failure("egress.proxy-unavailable", "Egress proxy is unavailable; direct network access is forbidden.");
  }

  const isDirectIp = isIP(requestHost) > 0;
  const hostAllowed = policy.mode === "allowlist" && allowedHosts.includes(requestHost);
  const redirectAllowed = decision.redirectChain.every((host) => allowedHosts.includes(host));

  if (decision.decision === "allowed" && isDirectIp) {
    return failure("egress.direct-ip-forbidden", "Direct IP access cannot bypass the hostname allowlist.");
  }
  if (decision.decision === "allowed" && !redirectAllowed) {
    return failure("egress.redirect-forbidden", "Redirect target is outside the declared hostname allowlist.");
  }
  if (policy.mode === "deny") {
    return decision.decision === "blocked" && decision.resolvedAddresses.length === 0
      ? { code: "egress.decision-valid", status: "pass", message: "Proxy decision matches the egress policy." }
      : failure("egress.policy-bypass", "Network access was allowed while the policy is deny.");
  }
  if (!hostAllowed) {
    return decision.decision === "blocked" && decision.resolvedAddresses.length === 0
      ? { code: "egress.decision-valid", status: "pass", message: "Proxy decision matches the egress policy." }
      : failure("egress.allowlist-mismatch", "Network access was allowed for a host outside the allowlist.");
  }
  if (decision.decision !== "allowed" || decision.resolvedAddresses.length === 0) {
    return failure("egress.allowlist-mismatch", "Allowlisted network access lacks an authorized proxy resolution.");
  }
  if (decision.resolvedAddresses.some(isUnsafeResolvedAddress)) {
    return failure(
      "egress.resolved-address-forbidden",
      "Allowed proxy resolution contains a loopback, private, link-local, metadata, or reserved address.",
    );
  }
  return { code: "egress.decision-valid", status: "pass", message: "Proxy decision matches the egress policy." };
}
