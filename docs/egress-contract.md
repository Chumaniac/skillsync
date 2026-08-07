# Egress Proxy Contract

`src/sandbox/egress-contract.ts` is the offline contract layer for a future
controlled egress proxy. It does not open sockets, perform DNS, set proxy
environment variables, or change Docker's current `network.mode: deny`
behavior.

The contract binds every decision to a request id, normalized host, port and
protocol. A valid decision may contain only bounded IP resolution results and
redirect hostnames; it cannot carry URL, header, body, cookie, prompt or
credential fields.

The policy rejects:

- IP addresses in hostname allowlists or redirect chains;
- direct IP authorization under a hostname allowlist;
- redirect targets outside the allowlist;
- allowed decisions when the proxy is unavailable;
- allowed decisions whose resolution contains any loopback, RFC1918/private,
  shared, link-local/metadata, multicast, benchmark, unspecified, or other
  explicitly reserved address; mixed public and unsafe resolutions fail closed;
- any network authorization under `mode: deny`;
- decisions that do not use the approved proxy enforcement point.

The resolved-address check is pure and deterministic. It covers IPv4-mapped
IPv6 addresses and IPv6 loopback, unspecified, link-local, unique-local,
site-local, discard-only, and multicast ranges. Documentation-only TEST-NET
values used by the checked-in fixtures, including `203.0.113.10`, remain valid
public stand-ins and are not treated as private or local addresses by this
offline contract.

Until a separately reviewed proxy/sidecar exists, this module is a contract
test surface only. `allowlist` remains unsupported by the Docker backend.

## Offline egress simulator

`src/sandbox/egress-simulator.ts` provides a pure, deterministic
`simulateEgressDecision(request, scenario)` implementation for the finite
scenarios in `fixtures/runtime/egress/`:

- `allowed` records a successful proxy decision for an allowlisted hostname;
- `proxy-unavailable` blocks without a resolution when the proxy is absent;
- `direct-ip` exercises the hostname allowlist's direct-IP rejection;
- `redirect-revalidation` exercises a redirect outside the declared scope;
- `dns-rebinding` blocks a resolution whose authority cannot be revalidated.

The simulator validates scenario names with a strict schema, normalizes the
request and decision through the egress contract, and rejects unknown
scenarios with `egress.decision-invalid`. `evaluateSimulatedEgressDecision`
delegates policy matching to `evaluateEgressDecision`; the simulator does not
duplicate allowlist logic.

`simulateEgressEvidence` emits an `evidenceMode: "offline-simulated"` marker,
bounded audit facts, and canonical SHA-256 digests for the normalized request,
proxy decision, and evidence record. The mode marker is part of the
digest-bound evidence body, so simulated evidence cannot be conflated with
live provider or Worker evidence. Audit evidence is capped at eight records
and 4 KiB, and contains no URL, body, header, cookie, credential, or secret
values. Repeated calls and equivalent host normalization produce the same
digests.

This is `offline-simulated` conformance evidence. The simulator does not use
`fetch`, HTTP clients, DNS, sockets, child processes, provider SDKs, ambient
environment values, or a host fallback. Replay behavior and Docker's existing
`network.mode: deny` behavior are unchanged, and live capability flags remain
disabled.
