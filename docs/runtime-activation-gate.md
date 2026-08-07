# Runtime Capability Activation Gate

`src/sandbox/runtime-capability-gate.ts` is a pure check layer that runs before any real
runtime capability is enabled. It does not open sockets, read environment variables or
secrets, create containers, or connect to remote Workers. The current Replay path and
the Docker `network.mode: deny` path are not changed by it.

## Mandatory order

Capabilities may enter canary only in this order:

1. `egress`
2. `provider-credentials`
3. `docker-microvm`
4. `remote-worker`

Each activation must satisfy all of the following at the same time:

- an independent security reviewer has issued a non-expired Ed25519 attestation for the
  current capability, artifact, and already-enabled stages;
- the controlled environment has issued a non-expired attestation for the same evidence
  set;
- the image, Runner contract, and every required policy use immutable digests;
- every earlier stage has a trusted activation receipt;
- the review, environment, and activation receipt all bind the same activation-context
  digest to prevent cross-project replay;
- the input contains no credential values, only digests or identities for external
  references.

Check failures return stable `runtime.*` findings. Signatures bind the capability,
artifact, and already-enabled stages so callers cannot forge a Boolean flag or an
activation list. A pass means only that the preconditions for activation are complete;
it does not mean that the real capability has already been turned on. Actual activation
must still be completed by a separate canary, rollback switch, and audit record.

`RuntimeTrustPolicy` cannot be passed in directly as an ordinary caller object. A
deployment-owned `RuntimeTrustRoot` must first verify the signed trust-policy bundle to
produce a non-forgeable trusted policy object. The root cannot be read from request
payloads, fixtures, or Worker-returned data. `runtime-activation-policy` passes the
policy source and the separate deployment-owned root pin as distinct inputs, and the
source cannot carry and self-attest its own root. The current pure module can verify
only the root pin that it receives, so live activation still requires deployment-side
protection, rotation, and enforcement wiring.

`runtime-activation-policy` explicitly parses the `deployment-config` bootstrap and
validates the root public-key fingerprint. `runtime-activation-boundary` is the only
authorization entrypoint that future adapters should call. It records only capability
state; it does not create containers, access the network, or inject credentials. Future
adapters should allocate capability only through `activateRuntimeCapability` after
authorization succeeds. No real adapter in the current repository is wired to that
entrypoint yet.

`runtime-orchestrator` keeps the simulated and live paths explicitly separated.
`runSimulatedRuntime` can call only the injected `simulatedProvider`, accepts only
`offline-simulated` provider evidence, does not require the activation boundary, and
does not switch to a live port when simulation fails. `runLiveRuntime` can call only the
injected `liveProvider` and passes the signed activation input to
`activateRuntimeCapability`; the provider port is called only after the gate passes.
Missing, forged, expired, out-of-order, or cross-context boundaries all return bounded
`blocked` findings and do not call any port.

Both paths pass an explicit `AbortSignal`. Provider results are parsed again through the
bounded runtime schema; unknown fields, unbounded evidence, or results that treat
`offline-simulated` as live evidence are discarded as bounded failures and do not fall
back to the other path. The current CLI does not call `runLiveRuntime`, so live
capabilities in the repository remain disabled.

`runtime-readiness` is explicitly marked `authoritative: false`. It is only an offline
pre-deployment summary and cannot replace the signed gate, deployment-owned root
pinning, controlled-environment evidence, or independent security approval.

External activation requirements are already fixed in
[`runtime-deployment-requirements.schema.json`](../config/runtime-deployment-requirements.schema.json)
and the reference-only
[`runtime-deployment-requirements.template.json`](../config/runtime-deployment-requirements.template.json).
The template contains only deployment key-store, mTLS, and controlled-environment
references. It does not contain real keys, certificates, tokens, or endpoints, and it
cannot be used directly as an activation switch. The pure parser rejects live mode,
contract Workers, host mounts, automatic pulls, and configurations that omit a boundary
or rollback path.

## Current status

Independent security approval and controlled-environment validation are still incomplete,
so all four capabilities remain disabled. This gate fixes the order and evidence
requirements for future real network access, credential injection, Docker/microVM, and
remote Worker enablement so that no implementation can bypass review or fall back
directly to the host environment.
