# Security Review Record: Egress, Provider Adapter, and Remote Runtime

**Review status:** Offline contract hardening complete; real-capability approval denied pending deployment trust-root, enforcement wiring, and authenticated remote receipt review
**Scope:** Offline contracts added in the 2026-08-05 runtime phase
**Live capability status:** Not enabled

## Review boundary

This record covers:

- `src/sandbox/egress-contract.ts`
- `src/sandbox/provider-adapter.ts`
- `src/sandbox/remote-contract.ts`
- `src/sandbox/remote-receipt.ts`
- `src/sandbox/runtime-capability-gate.ts`
- `src/sandbox/runtime-activation-policy.ts`
- `src/sandbox/runtime-activation-boundary.ts`
- `src/sandbox/runtime-readiness.ts`
- `src/sandbox/runtime-deployment-requirements.ts`
- `src/sandbox/runtime-ports.ts`
- `src/sandbox/runtime-evidence.ts`
- `src/sandbox/runtime-orchestrator.ts`
- `src/sandbox/credential-contract.ts`
- `src/sandbox/reference-provider-adapter.ts`
- `src/sandbox/egress-simulator.ts`
- `src/sandbox/microvm-contract.ts`
- `src/sandbox/remote-worker-port.ts`
- `src/cli/commands/provider-adapter.ts`
- the corresponding contract, CLI, documentation, and side-effect tests

The review does not approve a network proxy, provider credential injection,
Docker allowlist networking, a remote worker, or a microVM backend. Those
capabilities remain outside the current implementation and require a separate
review before they can be enabled.

## Evidence collected

| Area | Evidence | Result |
| --- | --- | --- |
| Egress fail-closed decisions | `tests/sandbox/egress-contract.test.ts` | 30 passing tests, including resolved-address safety |
| Provider manifest binding | `tests/sandbox/provider-adapter.test.ts` | 9 passing tests |
| Remote lifecycle and cleanup | `tests/sandbox/remote-contract.test.ts` | 17 passing tests |
| Runtime capability activation gate | `tests/sandbox/runtime-capability-gate.test.ts` | 6 passing tests |
| Runtime activation policy bootstrap | `tests/sandbox/runtime-activation-policy.test.ts` | 8 passing tests |
| Runtime activation boundary | `tests/sandbox/runtime-activation-boundary.test.ts` | 7 passing tests |
| Runtime ports and evidence modes | `tests/sandbox/runtime-ports.test.ts` and `tests/sandbox/runtime-evidence.test.ts` | 10 passing tests |
| Credential reference contract | `tests/sandbox/credential-contract.test.ts` | 8 passing tests |
| Authenticated remote receipts | `tests/sandbox/remote-receipt.test.ts` | 4 passing tests, including max TTL |
| Readiness posture | `tests/integration/runtime-activation-readiness.test.ts` | 5 passing tests |
| Deployment requirements contract | `tests/sandbox/runtime-deployment-requirements.test.ts` and `tests/integration/runtime-deployment-requirements.test.ts` | 15 passing tests |
| Offline provider reference adapter | `tests/sandbox/reference-provider-adapter.test.ts` | 7 passing tests |
| Offline egress simulator | `tests/sandbox/egress-simulator.test.ts` | 14 passing tests |
| MicroVM contract simulator | `tests/sandbox/microvm-contract.test.ts` | 9 passing tests |
| Remote Worker contract simulator | `tests/sandbox/remote-worker-port.test.ts` | 7 passing tests |
| Runtime orchestration boundary | `tests/sandbox/runtime-orchestrator.test.ts` | 11 passing tests |
| Live-runtime preparation integration | `tests/integration/live-runtime-preparation.test.ts` | 5 passing tests |
| CLI input boundary | `tests/cli/provider-adapter.test.ts` and `tests/cli/help.test.ts` | 10 passing tests |
| Side-effect boundary | `tests/security/contracts-no-side-effects.test.ts` | 20 passing tests |
| Public report path redaction | CLI and reporter regression tests | Default JSON/text/SARIF output replaces absolute local paths; explicit local policy is covered |
| Full regression | `npm test` | 400 passed, 1 skipped Docker integration test |
| Static and packaging checks | type-check, lint, build, `npm pack --dry-run` | Passing |

## 2026-08-06 local release-candidate verification

The following is fresh repository-local evidence from the release-candidate
checkout. It is offline evidence only: no controlled CI environment, live
endpoint, provider credential, Docker daemon, microVM, or remote Worker was
used. The skipped Docker integration remains a skip rather than a live result.

| Check | Fresh result |
| --- | --- |
| Full regression | `npm test`: 68 test files passed, 1 skipped; 400 tests passed, 1 skipped |
| Focused runtime preparation | 7 test files passed; 61 tests passed; simulator evidence remained `offline-simulated` |
| Type, lint, and build gates | `npm run type-check`, `npm run lint`, and `npm run build` passed locally |
| Package dry-run | `npm pack --dry-run` passed; 262 package files listed; no publish step |
| Workflow YAML parse | 4 `.github/workflows/*.yml` files parsed successfully |
| JSON/schema parse | 20 tracked JSON documents parsed successfully, including 3 JSON Schema documents |
| Public-tree secret/private-path scan | No personal-path or secret-like matches; no `.env`, key, certificate, or keystore files found outside ignored/generated exclusions |
| Source side-effect scan | `tests/security/contracts-no-side-effects.test.ts`: 20 AST and boundary tests passed |
| Live boundary/order scan | 4 deployment entrypoints were `not-enabled`; the activation order remained `egress → provider-credentials → docker-microvm → remote-worker`; the only live workflow input remained false-only |
| Diff and package review | Only the four Task 7 documentation files were changed; no raw credential, private path, generated artifact, or workflow/test/SDD package inclusion was found |

The focused command was:

```text
npx vitest run tests/sandbox/runtime-ports.test.ts tests/sandbox/reference-provider-adapter.test.ts tests/sandbox/egress-simulator.test.ts tests/sandbox/microvm-contract.test.ts tests/sandbox/remote-worker-port.test.ts tests/sandbox/runtime-orchestrator.test.ts tests/integration/live-runtime-preparation.test.ts
```

These checks verify preparation and fail-closed contracts. They do not prove
controlled-environment isolation, production proxy behavior, credential
revocation, microVM execution, or remote Worker authentication.

## 2026-08-07 report privacy-boundary verification

The report privacy gap identified during the next-stage implementation was
closed locally. `scan`, `compat`, and `verify` now redact absolute local paths
by default; `verify` carries the parsed reporting policy in the report so the
trusted local-only opt-in is explicit and survives report validation. SARIF
locations omit redacted absolute paths, while relative evidence paths remain
available. Embedded paths in finding messages and remediation are also
redacted.

Fresh evidence: 10 focused tests passed for the new regression set, followed
by the full suite with 68 test files passed, 1 skipped, and 419 tests passed,
1 skipped; type-check and lint passed. No live capability, endpoint,
credential, Docker daemon, microVM, or remote Worker was used.

## 2026-08-07 local deliverability verification

The follow-up local gate also covered package and lock interoperability. The
current `npx skills` v3 lock shape is imported with original fields preserved
under `metadata.external`; its `skillFolderHash` is not accepted as a local
content digest, so incomplete imported locks fail closed during `lock --check`.
Generated consumer CI pins the package version, and a fresh tarball install
successfully ran the CLI after fixing macOS symlinked entry-path detection.

Fresh evidence: 68 test files passed, 1 skipped, and 422 tests passed, 1
skipped; type-check, lint, build, and diff checks passed. No package publish,
Git push, live capability, endpoint, credential, Docker daemon, microVM, or
remote Worker was used.

## 2026-08-07 offline runtime-candidate verification

Ten runtime-preparation test files passed with 88 tests. Four workflow files
and two packaged CI templates parsed successfully; the package dry-run listed
265 files. Docker reference execution remained availability-gated because the
local daemon socket was absent. No daemon was started, no host fallback was
used, and all runtime capabilities remained disabled.

## Required security properties

- Egress decisions are request-bound, allowlist-bound, and fail closed.
- Direct IP authorization, redirect re-authorization, policy bypass, and
  unavailable-proxy success are rejected.
- Provider manifests bind adapter version, provider version, runner contract,
  and immutable image digest without accepting credential values.
- Remote lifecycle transitions require explicit cancellation and deletion
  proofs before `cleaned`; retries require cleanup of the current attempt and
  external resource/staging/event anchors for the next attempt.
- Remote completion and cleanup evidence must additionally carry an authenticated,
  short-lived Worker receipt bound to the run, attempt, resource, and digests;
  secure lifecycle mode rejects the transition without that receipt and enforces
  a one-hour maximum receipt lifetime.
- The new contracts do not open sockets, resolve DNS, read ambient credentials,
  or contact a remote worker.
- Public evidence remains bounded and does not contain raw prompts, tokens,
  cookies, headers, bodies, or provider stderr.
- Deployment requirements are reference-only declarations; the parser does not
  resolve key stores, mTLS, endpoints, Docker, microVMs, or Worker state.

## Open approval items

1. An independent reviewer must inspect the enforcement points and failure
   modes and record a verdict here.
2. The deployment must provide and pin the `RuntimeTrustRoot`; the pure gate
   cannot prove the provenance of a root supplied by its caller.
3. Every real execution path must invoke the runtime gate before Docker/microVM,
   credential, network, or Worker activation; the current Docker network-deny
   baseline remains separate from future capability activation, and no live
   adapter is currently wired to the boundary; the helper rejects structurally
   forged boundary objects.
4. A real proxy implementation, provider adapter image, and remote worker must
   each receive a separate threat model and rollout approval.
5. Docker and microVM integration must run in a controlled CI environment with
   explicit network and credential isolation tests.
6. Deployment-provisioned Worker keys or mTLS identity must be wired into the
   explicit `secure` remote lifecycle mode; content digests alone are insufficient.

Until these items are approved, this phase is contract-only and remains
fail-closed.

## Review findings and remediation

The first independent review found three critical and two important issues.
The final follow-up review found one critical and one important issue. They were
addressed locally before any live capability was considered:

- Adapter validation now requires an external immutable `--image` reference;
  the manifest's own digest is never used as its trust anchor.
- Host allowlists and redirect chains reject IP literals, and request binding is
  covered independently for id, host, port, and protocol.
- Remote cleanup uses a run/resource/digest-bound `cleanup_proof`, verifies its
  evidence digest, accepts only exact duplicate evidence, and rejects changed
  evidence.
- The remote state machine now requires an externally assigned resource ID and
  expected Runner event digest, and treats delayed terminal cancellation and
  disconnect events as idempotent no-ops.
- Side-effect regression checks now use AST inspection for dangerous module
  imports, dynamic imports, `require`, bracketed environment access, worker
  creation, and common DNS, network, TLS, and process APIs.
- Adapter/provider/version drift is checked against an external identity policy
  instead of values copied from the manifest being validated; the exact policy
  bytes must also match an externally supplied SHA-256 digest.
- Retry is now an explicit attempt transition: the current attempt must be
  cleaned first, the next attempt must match an externally supplied resource,
  staging, and event-digest anchor, and exact/altered duplicate requests have
  separate idempotency behavior.
- Runtime capability activation is now separately gated by a signed trust-policy
  bundle rooted in a deployment-owned `RuntimeTrustRoot`, plus trusted signed
  independent-review and controlled-environment attestations, signed prior
  activation receipts, immutable artifacts, and the declared egress → provider
  credentials → Docker/microVM → remote Worker order.
- A deployment-config bootstrap, single activation boundary, and manual-only
  readiness canary now prepare these checks without enabling live capabilities;
  secure remote lifecycle mode also enforces authenticated receipts before
  terminal and cleaned states.
- Credential input is now a strict external-reference contract: values, tokens,
  ambient environment data, path traversal and malformed references are rejected;
  requests are bounded by declared scope, TTL and mandatory revocation.
- AST regression fixtures now cover static imports, import-equals/export
  re-exports, DNS resolver variants, server/listen APIs, process APIs, and
  namespaced workers; the pure `node:net` `isIP` import remains documented as an
  intentional exception.

The remediation set passed the targeted security contracts and type-check. A final
independent approval is still required before activating any real proxy,
provider adapter, or remote worker.

## Reviewer log

| Date | Reviewer | Result | Notes |
| --- | --- | --- | --- |
| 2026-08-05 | Automated targeted review request | Not ready; 3 critical and 2 important findings | Findings were fixed and targeted regression re-run |
| 2026-08-05 | Automated follow-up review | No critical findings; important follow-ups identified | Resource/event anchors, late cancellation, AST fixtures, and external policy were added after this review |
| 2026-08-05 | Maintainer verification | Remediated locally | 49 targeted tests and type-check passed; final independent approval remains pending |
| 2026-08-05 | Final independent review | Critical: retry contract missing; important: AST fixture breadth | Both findings were remediated locally; no capability was enabled |
| 2026-08-05 | Maintainer remediation verification | Remediated locally | historical baseline: targeted contracts, 229 full tests passed, 1 Docker integration skipped; final independent approval remained pending |
| 2026-08-05 | Automated remediation re-review request | No verdict within the bounded review window | No capability was enabled; the security gate remains open |
| 2026-08-05 | Independent follow-up review | Not approved | Trust-root provenance, runtime enforcement wiring, receipt lifetime, and deployment Worker-key provisioning remain obligations |
| 2026-08-05 | Activation preparation verification | Prepared, not enabled | Policy bootstrap, activation boundary, remote receipt contract, and readiness canary passed local checks; live approval remains denied |
| 2026-08-05 | Independent security review | Not approved | Trust-root provenance, live entrypoint wiring, deployment Worker-key provisioning, and controlled canary evidence remain external gates |
| 2026-08-05 | Final independent security review | Not approved | Local boundary hardening passed; deployment root provenance, live adapter wiring, Worker key/mTLS provisioning, and controlled Docker/microVM evidence remain mandatory |
| 2026-08-05 | Deployment requirements contract review | Prepared, not enabled | No new code-level critical/important findings; declaration remains non-authoritative and all live capabilities remain closed |
| 2026-08-06 | Maintainer local release-candidate verification | Local gates passed; independent approval still not granted | 68 test files passed, 1 skipped; 400 tests passed, 1 skipped; focused runtime preparation passed 61 tests; all evidence remained offline/local and live capability remained disabled |
| 2026-08-07 | Maintainer report privacy-boundary verification | Local remediation passed; independent approval still not granted | Default report paths and embedded absolute paths are redacted; explicit local opt-in is policy-controlled; 419 tests passed, 1 skipped; all runtime capabilities remained disabled |
| 2026-08-07 | Maintainer local deliverability verification | Local remediation passed; independent approval still not granted | npx skills v3 lock import, pinned CI template, and clean tarball CLI smoke passed; 422 tests passed, 1 skipped; all runtime capabilities remained disabled |
