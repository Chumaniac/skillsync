# Live Runtime Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the repository-safe Provider Adapter, egress, microVM, remote Worker, activation wiring, canary, and release preparation layers while keeping every real capability disabled until independent security review and controlled-environment evidence exist.

**Architecture:** Add framework-free ports and deterministic simulators around the existing sandbox contracts. The CLI and domain remain offline-first; concrete provider/network/secret/runtime implementations stay outside the repository core and can only be reached through the existing activation boundary. Controlled canary and release workflows verify preparation without resolving secrets or enabling live execution.

**Tech Stack:** TypeScript, Zod, Vitest, Node.js 20+, GitHub Actions YAML, JSON Schema, npm packaging.

## Global Constraints

- Runtime activation order is exactly `egress`, `provider-credentials`, `docker-microvm`, `remote-worker`.
- `liveCapabilitiesEnabled` and `enable_live_capabilities` remain `false` in this repository and all normal CI.
- No raw credentials, private keys, cookies, authorization headers, secret-manager responses, live endpoints, or provider SDKs enter source, fixtures, reports, or package artifacts.
- No module may read ambient environment values, home directories, Docker sockets, SSH agents, devices, or broad host mounts.
- Replay and the existing Docker `network.mode: deny` behavior remain unchanged.
- Local simulators produce evidence marked `offline-simulated`; they are never represented as live Worker or provider evidence.
- Every live entrypoint must require a trusted `RuntimeActivationBoundary`; there is no bypass flag or fallback to host execution.
- Existing Node.js `>=20`, MIT license, type-check, lint, build, test, and package gates remain mandatory.

---

### Task 1: Freeze runtime ports and evidence modes

**Files:**
- Create: `src/sandbox/runtime-ports.ts`
- Create: `src/sandbox/runtime-evidence.ts`
- Modify: `src/sandbox/types.ts` only if shared result types are needed
- Create: `tests/sandbox/runtime-ports.test.ts`
- Create: `tests/sandbox/runtime-evidence.test.ts`

**Interfaces:**
- `RuntimeEvidenceMode = "offline-simulated" | "local-docker" | "controlled-microvm" | "remote-worker"`.
- `ProviderRunRequest` is `{ runId: string; attempt: number; skillDigest: Digest; inputDigest: Digest; policyDigest: Digest; imageDigest: Digest; adapterId: string; adapterVersion: string; provider: string; providerVersion: string; credentialContract: CredentialContract; egressPolicy: EgressPolicy; timeoutMs: number; maxOutputBytes: number }`.
- `ProviderRunResult` contains bounded Runner events, terminal status, event digest, redacted evidence digest, teardown result, and `evidenceMode`.
- `ProviderAdapterPort.run(request: ProviderRunRequest, signal: AbortSignal): Promise<ProviderRunResult>`.
- `EgressPort.decide(request: EgressRequest, policy: EgressPolicy): Promise<EgressProxyDecision>`.
- `MicrovmPort.checkAvailable(request: RunSpec): Promise<BackendAvailability>`, `provision(request: RunSpec): Promise<SandboxHandle>`, `execute(handle: SandboxHandle, request: RunSpec, onEvent: (event: RunnerEvent) => Promise<void>, signal: AbortSignal): Promise<BackendExecutionResult>`, and `teardown(handle: SandboxHandle): Promise<TeardownResult>`; it is not added to the default CLI backend union.
- `RemoteWorkerPort.provision(request: RemoteRunRequest): Promise<RemoteResource>`, `execute(resource: RemoteResource, request: RemoteRunRequest, signal: AbortSignal): Promise<RemoteLifecycleEvent[]>`, and `teardown(resource: RemoteResource): Promise<RemoteLifecycleEvent>`; the request contains only run/attempt/resource/digest fields and external references.
- `RuntimeExecutionResult = { status: "passed" | "failed" | "blocked"; evidenceMode: RuntimeEvidenceMode; result?: ProviderRunResult; finding?: RuntimeCapabilityFinding }`.

- [ ] **Step 1: Add failing type-level/runtime tests** proving valid requests contain digests and external credential references only, and that an unknown evidence mode or raw credential field is rejected.
- [ ] **Step 2: Run the focused tests** and confirm the new ports are absent.
- [ ] **Step 3: Implement strict Zod schemas and readonly normalized types** without importing network, Docker, provider, or secret-manager modules.
- [ ] **Step 4: Add evidence-mode normalization** so simulated, local Docker, controlled microVM, and remote Worker evidence cannot be conflated.
- [ ] **Step 5: Run focused tests, type-check, and side-effect inspection.**

### Task 2: Add the inert Provider Adapter reference implementation

**Files:**
- Create: `src/sandbox/reference-provider-adapter.ts`
- Create: `fixtures/runner/reference-provider-request.json`
- Create: `fixtures/runner/reference-provider-events.jsonl`
- Create: `tests/sandbox/reference-provider-adapter.test.ts`
- Modify: `tests/security/contracts-no-side-effects.test.ts`
- Modify: `docs/provider-adapter.md`

**Interfaces:**
- `createReferenceProviderAdapter(): ProviderAdapterPort`.
- The reference adapter accepts only the normalized `ProviderRunRequest` from Task 1.
- It emits deterministic `skillsync.runner.v1` events from checked-in fixture data and returns `evidenceMode: "offline-simulated"`.
- It never opens a socket, reads a secret, executes a provider, invokes a shell, or falls back to host execution.

- [ ] **Step 1: Write failing tests** for deterministic event replay, bounded output, cancellation, malformed event rejection, digest binding, and rejection of a request containing a credential value.
- [ ] **Step 2: Run the focused tests** and verify the reference adapter is not implemented.
- [ ] **Step 3: Implement the minimal fixture-backed adapter** using existing Runner event parsers and redaction utilities.
- [ ] **Step 4: Add source/AST side-effect assertions** covering provider SDK imports, socket APIs, child-process execution, ambient environment reads, and secret-like fields.
- [ ] **Step 5: Run focused tests, documentation tests, type-check, and lint.**

### Task 3: Add the pure egress simulator and conformance fixtures

**Files:**
- Create: `src/sandbox/egress-simulator.ts`
- Create: `fixtures/runtime/egress/allowed.json`
- Create: `fixtures/runtime/egress/proxy-unavailable.json`
- Create: `fixtures/runtime/egress/direct-ip.json`
- Create: `fixtures/runtime/egress/redirect-revalidation.json`
- Create: `fixtures/runtime/egress/dns-rebinding.json`
- Create: `tests/sandbox/egress-simulator.test.ts`
- Modify: `tests/security/contracts-no-side-effects.test.ts`
- Modify: `docs/egress-contract.md`

**Interfaces:**
- `simulateEgressDecision(request, scenario): EgressProxyDecision`.
- The simulator delegates normalization and policy matching to `src/sandbox/egress-contract.ts` and emits no network side effect.
- Scenario names are finite and checked by schema; unknown scenarios fail closed.

- [ ] **Step 1: Add failing tests** for proxy-unavailable, direct-IP, DNS rebinding, redirect scope change, allowlist success, and bounded audit evidence.
- [ ] **Step 2: Run the focused tests** and verify no network is opened.
- [ ] **Step 3: Implement deterministic scenarios** with stable request, decision, and evidence digests.
- [ ] **Step 4: Add no-side-effect coverage** for `node:net`, fetch/http clients, DNS calls, and environment reads in the simulator.
- [ ] **Step 5: Run focused tests and update the egress contract documentation.**

### Task 4: Add microVM and remote Worker contract simulators

**Files:**
- Create: `src/sandbox/microvm-contract.ts`
- Create: `src/sandbox/remote-worker-port.ts`
- Create: `fixtures/runtime/microvm/reference-config.json`
- Create: `fixtures/runtime/remote-worker/reference-lifecycle.json`
- Create: `tests/sandbox/microvm-contract.test.ts`
- Create: `tests/sandbox/remote-worker-port.test.ts`
- Modify: `tests/sandbox/remote-contract.test.ts` only to share existing lifecycle fixtures where safe
- Modify: `tests/security/contracts-no-side-effects.test.ts`
- Modify: `docs/remote-lifecycle.md`
- Modify: `docs/security-boundary.md`

**Interfaces:**
- `parseMicrovmContract(input: unknown): MicrovmContract | null`.
- `evaluateMicrovmContract(input: unknown): MicrovmFinding`.
- `RemoteRunRequest` is `{ runId: string; attempt: number; resourceId: string; stagingDigest: Digest; inputDigest: Digest; imageDigest: Digest; contextDigest: Digest; mode: "contract" | "secure" }`.
- `RemoteResource` is `{ runId: string; attempt: number; resourceId: string; stagingDigest: Digest }`.
- `createRemoteWorkerSimulator(): RemoteWorkerPort`.
- The simulator must use existing attempt/resource/event digest binding and existing authenticated receipt verification; it must not create a Worker, contact a remote endpoint, or resolve mTLS references.

- [ ] **Step 1: Add failing tests** for host mounts, non-isolated mode, non-preseeded images, network allowlisting, missing cleanup proof, stale receipt, duplicate completion, retry-before-cleanup, and cancellation.
- [ ] **Step 2: Run the focused tests** and confirm all invalid cases fail closed.
- [ ] **Step 3: Implement strict microVM contract parsing and deterministic remote lifecycle simulation.**
- [ ] **Step 4: Add source-level checks** proving no remote client, socket, cloud SDK, credential value, or process fallback exists.
- [ ] **Step 5: Run focused tests, security tests, type-check, and lint.**

### Task 5: Add activation-boundary orchestration without enabling live capability

**Files:**
- Create: `src/sandbox/runtime-orchestrator.ts`
- Create: `tests/sandbox/runtime-orchestrator.test.ts`
- Modify: `src/sandbox/runtime-activation-boundary.ts` only if the orchestration needs a typed port helper
- Modify: `tests/sandbox/runtime-activation-boundary.test.ts`
- Modify: `docs/runtime-activation-gate.md`

**Interfaces:**
- `runSimulatedRuntime(request, ports): Promise<ProviderRunResult>` uses only the deterministic simulators and records `offline-simulated` evidence.
- `runLiveRuntime(request, ports, boundary): Promise<RuntimeExecutionResult>` must call `activateRuntimeCapability` before any live port method and return a bounded failure when the boundary is absent, untrusted, out of order, expired, or context-mismatched.
- No CLI command invokes `runLiveRuntime` in this repository.

- [ ] **Step 1: Write failing tests** proving simulation works without live capability, live orchestration rejects null/untrusted boundaries, and a rejected gate never calls a port.
- [ ] **Step 2: Run the focused tests** and observe the expected missing orchestrator failure.
- [ ] **Step 3: Implement the two orchestration paths** with explicit evidence modes and no fallback between them.
- [ ] **Step 4: Add regression tests** for capability order, context binding, cancellation, and bounded result redaction.
- [ ] **Step 5: Run the full runtime contract subset and side-effect tests.**

### Task 6: Integrate simulated runtime coverage into canary and release workflows

**Files:**
- Modify: `.github/workflows/skillsync-runtime-canary.yml`
- Modify: `.github/workflows/skillsync.yml`
- Create: `.github/workflows/release.yml`
- Modify: `docs/ci.md`
- Modify: `docs/release-readiness-2026-08-05.md`
- Modify: `docs/rollout-egress-provider-runtime.md`
- Create: `docs/runtime-operator-runbook.md`
- Create: `tests/integration/live-runtime-preparation.test.ts`
- Modify: `tests/docs/documentation.test.ts`

- [ ] **Step 1: Add failing integration/documentation tests** for offline simulator coverage, `enable_live_capabilities: false`, package artifact exclusion, and release workflow safety.
- [ ] **Step 2: Add the new contract tests to the manual canary** while keeping Docker reference smoke opt-in and live inputs false-only.
- [ ] **Step 3: Add a tag-based release validation workflow** that runs checks and package dry-run only; npm publication remains disabled while `private: true` is retained.
- [ ] **Step 4: Add the operator runbook** for activation, revocation, rollback, evidence review, and the exact external prerequisites; do not include real endpoints or secret locations.
- [ ] **Step 5: Run YAML parsing, integration/documentation tests, and the full local check suite.**

### Task 7: Independent local review and public release candidate verification

**Files:**
- Modify: `docs/security-review-egress-provider-runtime.md`
- Modify: `docs/release-readiness-2026-08-05.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Run the full test suite, type-check, lint, build, package dry-run, YAML/schema parse, public-tree secret scan, and source side-effect scan.**
- [ ] **Step 2: Verify every live entrypoint remains `not-enabled` and every live workflow input remains false-only.**
- [ ] **Step 3: Record exact evidence modes and test counts without claiming controlled or remote execution.**
- [ ] **Step 4: Review the complete diff for raw credentials, private paths, generated artifacts, and accidental package inclusion.**
- [ ] **Step 5: Create a local release-candidate commit with a generic non-machine identity.**

### Task 8: External security and controlled-environment handoff

**Files:**
- No live runtime source changes are authorized in this repository task.
- Update only deployment-owned records after external approval: `docs/security-review-egress-provider-runtime.md` and `docs/rollout-egress-provider-runtime.md`.

- [ ] **Step 1: Obtain an independent review verdict** for egress, credential injection, activation enforcement, Worker authentication, and report redaction.
- [ ] **Step 2: Provision a controlled environment** with deployment-owned trust root, immutable artifacts, mTLS, Worker keys, secret lease/revocation, and rollback controls.
- [ ] **Step 3: Run the egress canary only** and record proxy, DNS, redirect, direct-IP, metadata-service, and proxy-unavailable evidence.
- [ ] **Step 4: Run provider credential, Docker/microVM, and remote Worker canaries one at a time** only after the preceding capability has an approved receipt.
- [ ] **Step 5: Stop and leave all capabilities disabled** if any external evidence is missing, unauthenticated, unbounded, or not independently reviewed.

## Verification Commands

```bash
npm test
npm run type-check
npm run lint
npm run build
npm pack --dry-run
node --input-type=module -e 'import fs from "node:fs"; import { parse } from "yaml"; for (const file of fs.readdirSync(".github/workflows").filter((name) => name.endsWith(".yml"))) parse(fs.readFileSync(`.github/workflows/${file}`, "utf8")); console.log("workflow-yaml-ok");'
npx vitest run tests/sandbox/runtime-ports.test.ts tests/sandbox/reference-provider-adapter.test.ts tests/sandbox/egress-simulator.test.ts tests/sandbox/microvm-contract.test.ts tests/sandbox/remote-worker-port.test.ts tests/sandbox/runtime-orchestrator.test.ts tests/integration/live-runtime-preparation.test.ts
```

## Stop Conditions

Stop before implementation or activation if a requested change needs a raw credential, a live endpoint, a deployment-owned key, a public GitHub secret, a Docker socket, a host mount, a real remote Worker, a provider SDK in the CLI, or a bypass around `runtime-activation-boundary`. Report the exact missing external prerequisite instead of substituting a fake live result.
