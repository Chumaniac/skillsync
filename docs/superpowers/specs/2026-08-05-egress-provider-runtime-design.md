# Independent Design Boundaries for Egress, Provider Adapters, and Remote Runtime

## 1. Purpose

This document defines the security issues that must be resolved before SkillSync expands from a local, network-denying, black-box Runner contract to real providers and remote execution environments. It is the design entry point for the next phase and must not quietly introduce any unreviewed network, credential, or cloud capability into the current Docker backend.

## 2. Product commitments that remain unchanged

- SkillSync verifies bounded behavioral evidence, provenance, and compatibility; it does not certify an agent’s overall safety or quality.
- Provider SDKs, login state, token refresh, and specific agent versions belong in the Runner image or adapter and must not enter the host CLI.
- The default network mode remains `deny`; if we cannot prove that the execution boundary blocks bypass paths, the system must return `blocked`.
- All credentials must be short-lived, explicit, least-privilege inputs; fixtures and Runner events must never carry secret values.
- Remote execution must preserve the same `skillsync.runner.v1` event protocol, digest binding, timeout, cancellation, and teardown semantics.

## 3. Security questions that must be answered first

### 3.1 Allowlist egress

Do not turn `allowed_hosts` directly into the container’s `/etc/hosts`, proxy environment variables, or DNS resolution results.
The implementation must explain:

- how DNS rebinding is blocked, and whether resolved results are fixed and audited;
- whether direct IPs, IPv6, alternate ports, HTTP redirects, and CONNECT can bypass the host allowlist;
- whether a missing proxy blocks requests or degrades to direct connections; the answer must be block;
- whether the container can access the metadata service, unix sockets, the host gateway, and local DNS;
- how each allowed request writes bounded `network.request` evidence without leaking the URL, headers, or body.

The recommended boundary is a dedicated egress proxy or sidecar, with the proxy handling resolution, connection, and auditing; the Docker backend connects only to an unforgeable internal proxy address. Without that enforcement point, `allowlist` remains unsupported.

### 3.2 Provider credentials

Each provider adapter must have its own version matrix and credential contract, at minimum defining:

- the credential source, lifecycle, scope, injection timing, and revocation path;
- whether the provider CLI or SDK reads undeclared environment variables, the home directory, a credential helper, or the metadata service;
- how stdout and stderr, retry errors, diagnostic logs, and traces prevent token, prompt, and cookie leakage;
- how the provider version, image digest, adapter version, and behavior report are linked;
- how credential failures, expiry, rate limiting, and provider unavailability each produce stable findings.

The current `environment.allow` only expresses fixture declarations and does not provide a value source; that must not change before the credential contract is implemented.

### 3.3 Remote or microVM runtime

The remote backend cannot simply move Docker commands behind an HTTP API. It must define:

- the upload digest, encryption, retention time, and deletion proof for staging content;
- worker identity, execution authorization, tenant isolation, and the control-plane versus data-plane boundary;
- the actual enforcement points for network, process, filesystem, and resource limits on the worker;
- the semantics of client disconnects, cancellation, timeouts, worker crashes, and repeated teardown;
- the order, replay behavior, anti-tampering, and final digest of the remote event stream;
- proof of cross-tenant cleanup for logs, artifacts, credentials, and the workspace.

If we cannot prove a microVM or equivalent boundary, remote execution must not reuse the “Docker available” finding.

## 4. Suggested staged delivery

1. First build a threat model and black-box contract test for the allowlist egress proxy, without provider integration.
2. Then build a provider adapter conformance fixture with no real secrets, to verify inputs, outputs, and error boundaries.
3. Then simulate the local microVM or remote-worker protocol, proving cancellation, retry, teardown, and evidence digest behavior first.
4. Only after that evaluate real provider credentials and cloud multi-tenancy, with separate review of secret management and operational permissions.

Each stage must preserve Replay, Docker deny, and current CLI behavior unchanged.

## 5. Out of scope for this phase

- the actual enforcement of `network.mode: allowlist`;
- real provider credentials for Codex, Claude, Cursor, and similar tools;
- registry login, automatic pulls, image-signature trust roots, or cloud deployment;
- multi-tenant authentication, billing, remote queues, or persistent artifact services;
- allowing arbitrary Skill scripts through a process allowlist.
