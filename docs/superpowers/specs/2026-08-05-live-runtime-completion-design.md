# SkillSync Live Runtime Completion Design

**Date:** 2026-08-05  
**Status:** Design approved for specification review; implementation not started  
**Scope:** Complete the remaining provider adapter, egress, controlled runtime, remote Worker, and release-readiness work without weakening SkillSync's offline fail-closed core.

## 1. Design decision

SkillSync remains a CLI-first verification and evidence product. Its domain and default CLI paths never read ambient credentials, open network connections, start provider processes, or treat a local Docker daemon as proof of production isolation.

Real runtime capabilities are separate outer adapters behind explicit ports. Every live entrypoint must pass the existing `runtime-activation-boundary` in the fixed order:

```text
egress → provider-credentials → docker-microvm → remote-worker
```

The repository can implement the ports, contracts, simulators, and controlled-canary checks locally. It must not claim live capability is enabled until deployment-owned trust roots, immutable artifacts, independent security review, and controlled-environment evidence are present.

## 2. Goals

- Provide a stable Provider Adapter port that does not pull provider SDKs or credential values into the CLI domain.
- Make egress, credential references, Runner execution, microVM execution, and remote Worker lifecycle explicit adapters.
- Preserve bounded evidence, authenticated receipts, cleanup proofs, and fail-closed behavior across every boundary.
- Add deterministic offline conformance fixtures and simulations for all live-capability failure modes.
- Make release and canary posture observable without turning readiness into an activation switch.
- Leave the repository in a state where a separately controlled deployment can enable one capability at a time after review.

## 3. Non-goals

- No provider token, cookie, private key, mTLS certificate, endpoint credential, or secret-manager response enters source, fixture, log, report, or commit.
- No ambient environment, home directory, SSH agent, Docker socket, device, broad host mount, or host process fallback is permitted.
- No live network, provider execution, allowlist proxy, microVM, or remote Worker is enabled by the local test suite or normal CI.
- No multi-tenant cloud control plane, user account system, billing, hosted dashboard, or provider marketplace is introduced in this slice.
- No claim is made that a Skill is safe merely because a contract or fixture passes.

## 4. Current boundaries and reusable modules

The implementation extends the current ports and contracts rather than moving live logic into the CLI:

| Existing boundary | Responsibility | Rule for the next phase |
| --- | --- | --- |
| `src/sandbox/provider-adapter.ts` | Adapter manifest, provider/version identity, image binding, credential declaration | Remains declarative and value-free |
| `src/sandbox/credential-contract.ts` | External secret reference, scope, TTL, revocation declaration | Never resolves or injects a secret |
| `src/sandbox/egress-contract.ts` | Offline request and proxy decision validation | Never opens a socket |
| `src/sandbox/docker.ts` | Opt-in digest-pinned network-denied Runner backend | Remains the only local live-like backend |
| `src/sandbox/remote-contract.ts` | Remote lifecycle, retry, cleanup, and attempt binding | Remains a simulator/contract until a Worker exists |
| `src/sandbox/remote-receipt.ts` | Authenticated Worker completion/cleanup receipt | Worker keys remain deployment-owned |
| `src/sandbox/runtime-capability-gate.ts` | Ordered signed review and environment evidence | Must precede every real capability allocation |
| `src/sandbox/runtime-activation-boundary.ts` | Non-forgeable per-context activation state | Is the only future live entrypoint authorization API |
| `src/sandbox/runtime-deployment-requirements.ts` | Strict reference-only deployment declaration | Is evidence, not a trust root or switch |

## 5. Hexagonal runtime architecture

The core uses ports; concrete network, provider, container, microVM, and Worker implementations live outside the domain.

```text
CLI / verification workflow
        |
        v
Application orchestrator
        |
        +--> ActivationBoundaryPort
        +--> ProviderAdapterPort
        +--> CredentialReferencePort
        +--> EgressPort
        +--> RunnerPort
        +--> RemoteWorkerPort
        |
        v
Bounded evidence + authenticated receipt + cleanup proof
        |
        v
Text / JSON / SARIF / evidence report
```

The domain receives normalized requests and produces decisions. Adapters translate those decisions into provider protocol, proxy protocol, Docker/microVM commands, or authenticated Worker messages. No inner module imports a concrete network client, secret manager, Docker SDK, cloud SDK, or provider SDK.

## 6. Provider Adapter contract

### 6.1 Identity

Every adapter manifest is bound to:

- provider identifier and supported provider version range;
- adapter version and protocol version;
- immutable Runner image digest;
- external provider identity policy digest;
- declared credential names, scopes, and maximum TTL;
- required Runner protocol and evidence schema.

The adapter manifest never carries credential values. A provider version is not trusted solely because it is self-declared; it must match an external identity policy supplied by deployment configuration.

### 6.2 Port behavior

The Provider Adapter port accepts a normalized run request containing a run id, attempt id, fixture/Skill digest, adapter identity, image digest, policy digest, credential references, egress policy, timeout, and output limits. It returns bounded Runner events, a terminal process result, a redacted evidence digest, and a cleanup result.

The port rejects:

- raw secret values or secret-like field names;
- an image reference without an immutable digest;
- an adapter/provider version mismatch;
- unbounded output, timeout, or process lifetime;
- unapproved tools, environment names, paths, or network mode;
- a call that has not passed the activation boundary for its capability.

### 6.3 Reference adapter

The repository will include an inert reference adapter that accepts the contract, emits deterministic JSONL events, and never contacts a provider. It exists to prove input/output shape, redaction, timeout, cancellation, and digest binding. It is not a provider-quality certification.

Real Codex, Claude, and Cursor adapters remain separate images and separate version matrices. They are not compiled into the SkillSync CLI.

## 7. Egress and credential wiring

### 7.1 Egress

The live egress adapter must route every request through an approved proxy. The proxy is responsible for hostname resolution, IP classification, redirect revalidation, metadata-service blocking, CONNECT policy, request limits, and bounded audit events.

The following are fail-closed conditions:

- proxy unavailable or identity mismatch;
- direct IP, private address, loopback, link-local, metadata-service, or disallowed IPv6 destination;
- DNS answer changes after policy evaluation;
- redirect leaves the approved host/policy scope;
- request exceeds byte, time, method, or redirect limits;
- adapter attempts a direct socket or unapproved protocol.

The local implementation first provides a pure proxy simulator and conformance fixtures. It does not add a network client to the default CLI.

### 7.2 Credentials

Credential flow is reference-only until deployment activation:

```text
deployment-owned secret reference
        → short-lived scoped lease
        → isolated Runner injection
        → revocation / deletion proof
```

Only the external reference identity, scope, TTL, lease id digest, and revocation result may cross the SkillSync evidence boundary. The value itself stays inside the deployment secret system and isolated Runner. Ambient environment lookup, home-directory discovery, credential helpers, and inherited process environment are forbidden.

## 8. Docker, microVM, and remote Worker boundaries

### 8.1 Docker

The current Docker backend remains network-denied and digest-pinned. It must not be widened to allowlist networking as a convenience. Reference image smoke tests can run in a controlled CI worker with preseeded inputs, but local daemon availability is not production evidence.

### 8.2 microVM

The microVM adapter implements the same Runner port and evidence schema as Docker, but must prove a stronger isolation boundary independently. It requires:

- controlled CI or deployment-owned runtime;
- immutable guest image and Runner contract;
- no host home, socket, credential, device, or broad mount;
- deny-by-default networking and explicit proxy attachment;
- bounded CPU, memory, process, output, and lifetime;
- authenticated teardown and deletion evidence.

The repository phase adds only the port, schema, simulator, and fail-closed evaluator. A real microVM backend cannot be marked enabled without external runtime evidence.

### 8.3 Remote Worker

Remote execution is an attempt-bound protocol, not a fire-and-forget job. Each attempt binds run id, attempt id, resource id, Worker identity, image digest, input digest, event digest, cleanup digest, and expiration.

Completion and cleanup require authenticated short-lived Worker receipts. Retries require cleanup of the previous attempt first. Worker crash, timeout, client disconnect, cancellation, duplicate completion, missing receipt, stale receipt, resource mismatch, and deletion failure all return bounded failure findings and never silently fall back to a local host process.

## 9. Activation and rollout

Capability state is explicit:

```text
not-enabled → prepared → canary-approved → enabled
```

The local repository may reach `prepared` for offline contracts and simulations only. `canary-approved` requires independent security review and controlled-environment attestations. `enabled` requires deployment-owned enforcement wiring, rollback controls, receipt verification, and an approved operational owner.

Only one capability advances at a time:

1. egress;
2. provider credentials;
3. Docker/microVM;
4. remote Worker.

If a gate fails, the system stays at the prior state and rejects the new capability. There is no bypass flag, environment-variable override, or “development mode” that turns a failed gate into live execution.

## 10. Evidence and reporting

Public reports contain only normalized event types, sequence numbers, bounded paths, byte counts, digests, policy decisions, capability state, receipt status, and cleanup status. They exclude:

- prompt or model text;
- file contents;
- environment values;
- authorization headers, tokens, cookies, or credential values;
- provider stderr or unrestricted logs;
- host-specific paths unless an explicit local-path policy permits them.

Every report identifies whether evidence is `offline-simulated`, `local-docker`, `controlled-microvm`, or `remote-worker`. A simulated receipt is never presented as a remote authenticated receipt.

## 11. Implementation sequence

### Phase A — repository-safe code completion

- Freeze the port types and adapter manifest contract.
- Add inert Provider Adapter and egress simulators.
- Add microVM and remote Worker ports with deterministic simulators.
- Add contract fixtures for cancellation, timeout, proxy failure, credential leakage, image mismatch, receipt mismatch, retry, and cleanup failure.
- Wire all future entrypoints through the existing activation boundary without enabling live capabilities.

### Phase B — controlled canary preparation

- Add immutable artifact and policy binding checks to the canary workflow.
- Add deployment-owned root and mTLS reference validation without resolving references.
- Add bounded readiness evidence and rollback drill simulation.
- Add an operator runbook for activation, revocation, rollback, and incident evidence.

### Phase C — external validation gates

- Obtain independent security review for egress and credential injection.
- Provision a controlled Docker/microVM environment with preseeded immutable artifacts.
- Provision Worker identity, mTLS, receipt verification, and deletion-proof infrastructure outside this repository.
- Run one capability canary at a time and record evidence in the release-readiness document.

### Phase D — optional live enablement

Only after Phase C passes may a deployment-specific adapter enable one capability. The open-source repository remains safe when all live capability flags are false; live configuration and secret values never belong in the repository.

## 12. Verification strategy

Local verification must include:

- unit tests for every port and parser;
- contract tests for valid, invalid, and boundary inputs;
- AST/source checks for network, ambient environment, shell, and credential bypasses;
- deterministic Replay and reference Docker tests;
- simulated remote lifecycle and authenticated receipt tests;
- documentation and workflow YAML checks;
- type-check, lint, build, package dry-run, and public-tree secret scan.

Controlled-environment verification must additionally include:

- proxy-unavailable and direct-connect denial;
- DNS rebinding, redirect, metadata-service, and IPv6 cases;
- short-lived credential lease, revocation, and deletion proof;
- Docker/microVM isolation and resource limits;
- Worker crash, cancellation, retry, duplicate, stale receipt, and cleanup cases;
- redacted report review by an independent operator.

## 13. Completion criteria

The repository implementation is complete for this design when Phase A and Phase B are implemented, all local gates pass, all live entrypoints remain `not-enabled`, and the documentation clearly separates simulated evidence from controlled live evidence.

The product is complete for live production use only when Phase C has an approved external record and a deployment has completed the one-capability-at-a-time rollout in `docs/rollout-egress-provider-runtime.md`. Local code, a passing unit test, or a reference Docker image alone cannot satisfy that condition.
