# Remote Runtime Lifecycle Contract

`src/sandbox/microvm-contract.ts` provides a strict, reference-only microVM
contract. A valid declaration proves only the required shape: isolated mode,
no host mounts, an immutable preseeded image, deny-by-default networking,
bounded limits, and teardown with cleanup proof. Its finding is
`authoritative: false` and its evidence mode is `offline-simulated`; it does
not allocate a microVM.

`src/sandbox/remote-contract.ts` provides an offline state machine for a future
remote backend, while `src/sandbox/remote-worker-port.ts` provides a
deterministic `createRemoteWorkerSimulator()` for contract tests. Neither
module makes HTTP calls, uploads a workspace, creates a Worker, resolves mTLS,
or claims that a remote Worker is available.

The Task 4 remote port accepts only run, attempt, resource, and digest bindings
plus an explicit `contract` or `secure` mode. The simulator binds the input,
image, context, and staging digests into a deterministic event digest and
returns bounded lifecycle events marked by contract context rather than a
live-runtime claim. Secure-mode output deliberately contains no receipt; the
existing authenticated receipt verifier must reject it until an external,
trusted Worker receipt is supplied.

The simulator is constructed with an expected worker/resource assignment and
an expected Runner event digest supplied by the local verification boundary.
Retry attempts additionally require a pre-registered map of external resource,
staging, and event-digest anchors. Remote lifecycle claims cannot establish any
of these values by themselves. A real backend still needs an authenticated
worker receipt and a separate tenant, staging, and deletion-proof review.
Terminal status and exit code are cross-checked: `passed` requires `0`, while
`failed` and `blocked` require a non-zero bounded exit code.

The lifecycle is:

```text
new -> created -> staged -> running -> finished -> tearing-down -> cleaned
                             \-> cancelling -/
running -> failed -> tearing-down
                         \-> cleaned -> staged (retry.requested, next anchored attempt)
```

Cancellation and client disconnect are idempotent. A run cannot start before
staging, and a remote execution cannot become `cleaned` until a strict
`cleanup_proof` binds `run_id`, `resource_id`, the staging digest, the event
digest, the attempt number, and an evidence digest covering deletion of
workspace, artifacts, logs, and credentials. A retry is accepted only after the
current attempt is cleaned, and its `attempt`, resource ID, staging digest, and
event digest must exactly match an external anchor supplied to the local
boundary. Exact duplicate retry and teardown evidence is accepted; changed
evidence is rejected. Lifecycle events are strict and bounded; raw artifacts,
logs, tokens and credential values are rejected.

Remote execution remains unavailable until a separate review covers worker
identity, tenant isolation, staging encryption/retention, retries, disconnects,
and teardown evidence. The prepared `remote-receipt` contract requires a
short-lived Ed25519 receipt bound to the run, attempt, resource, event digest,
and cleanup evidence digest; a self-consistent digest without an authenticated
Worker identity is still rejected. A secure `RemoteRunMachine` configuration
requires a trusted Worker-key map and rejects terminal or `cleaned` transitions
without a valid receipt. Stale receipts, duplicate completion, retry before
cleanup, incomplete cleanup proof, and cancellation are all fail-closed test
cases; the key map itself still must come from deployment
configuration or mTLS identity provisioning, never from a run request. The
constructor requires an explicit `contract` or `secure` mode; omitting the mode
is a configuration failure rather than a permissive default.
