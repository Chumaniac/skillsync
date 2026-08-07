# Security boundary

SkillSync is a verification and evidence tool, not a security certification.

The default boundary is:

- `scan`, `compat`, and `verify` do not execute Skill scripts;
- `test` without `--execute` only performs fixture preflight and reports runtime execution as `not-run`;
- `schema_version: 2` execution requires explicit `--execute --backend`; Replay only replays bounded fixture-local JSONL events, while Docker uses only a locally available daemon and image and never falls back to host execution;
- Docker images must satisfy the fixed Runner contract and entrypoint; an incompatible image returns `sandbox.image-contract-invalid` with code `4` before container creation;
- `adopt --plan` is read-only; `adopt --apply` only writes the explicitly named lock snapshot after `--yes`;
- filesystem reads are scoped to explicit targets and Skill roots;
- symlink targets outside a Skill root are not followed;
- no network request or content upload is performed by the domain modules;
- findings expose evidence and remediation, not claims of absolute safety;
- public JSON, text, and SARIF reports replace absolute local paths with `<local-path>` by default, including paths embedded in finding messages and remediation;
- provenance is `local-only` or `unknown` when a remote identity cannot be proved;
- CI generation is plan-only unless `ci init --apply` is explicitly supplied;
- existing CI files require `--force` before replacement.

Replay is deterministic protocol evidence, not a claim that a real Agent was
securely isolated. It does not start a process, access the network, inherit
environment values, or mutate the fixture. The Docker backend requires a
digest-pinned image, non-root user, read-only filesystem, explicit environment,
network denial, resource limits, and teardown guarantees; it never pulls an
image implicitly. The image must satisfy the [Runner contract](runner-contract.md),
and allowlist networking is rejected until a controlled proxy implementation
exists.

The `verify` policy field `reporting.include_local_paths` defaults to `false`.
It may be set to `true` only for a trusted local debugging report that will not
be uploaded or attached to a public issue. The redacted default keeps the
report schema consumable by `report` and preserves relative evidence paths,
digests, rule codes, and stable Issue IDs; it does not alter the no-script,
no-network, no-secret, or no-file-content boundary.

Static checks can miss prompt injection, runtime behavior, environment-specific
permissions, and vulnerabilities in external tools. Use the optional behavior
and security adapters only in an explicitly isolated environment with a human
reviewer and a policy appropriate to the target repository.

Docker output is independently checked against a staged workspace tree and
workspace evidence: a
missing, extra, changed, or deleted file without matching Runner evidence
becomes `invariant.workspace-evidence-mismatch`; file contents do not enter
public reports. `runner validate` can compare detached provenance to the exact
image digest. Signature fields are not treated as verified unless an explicitly
approved verifier is configured; requiring signature verification without one
returns `runner.signature-verification-unavailable`.

Provider adapter conformance is also offline-only: `runner adapter validate`
checks declared versions against an external identity policy, binds the result
to an external immutable image reference, and checks credential names and
Runner protocol without accepting credential values or contacting a provider.
`proxy-required` is a declaration, not a network capability; direct access
remains forbidden.

The runtime capability activation gate is also preflight-only. Its deployment
bootstrap requires a signed trust-policy bundle and a pinned `RuntimeTrustRoot`;
its activation boundary requires an independent security approval, a verified
controlled environment, immutable artifacts, and the declared egress → provider
credentials → Docker/microVM → remote Worker order. It does not open sockets,
read secrets, create containers, or connect to a Worker. Remote digests must be
accompanied by an authenticated Worker receipt before a future backend can treat
completion or cleanup as trusted.

The microVM contract simulator is declaration-only. It fails closed unless the
contract is explicitly isolated, host-mount-free, backed by an immutable
preseeded image, deny-by-default for networking, bounded by resource limits,
and requires teardown with a complete cleanup proof. Its result is bounded
`offline-simulated` contract evidence with `authoritative: false`; it is not
microVM attestation.

The remote Worker port is also offline-only. Its deterministic simulator binds
run, attempt, resource, staging, input, image, and context digests and emits
contract lifecycle events without creating a Worker, contacting a remote
service, resolving mTLS, reading credentials, or falling back to a host
process. In secure mode, missing or stale authenticated receipts remain
untrusted, and duplicate completion, retry-before-cleanup, incomplete cleanup,
and cancellation are exercised as fail-closed lifecycle cases. All live
capability flags remain false.

The external deployment requirements contract is also declaration-only:
`config/runtime-deployment-requirements.template.json` contains references to a
deployment key store and mTLS identity, never their values. Its pure validator
requires every future live entrypoint to use the activation boundary, requires
secure Worker receipts, and requires isolated, deny-by-default, host-mount-free
Docker/microVM conditions with rollback. A passing declaration is not proof that
the referenced store, certificate authority, runner, or environment is trusted.
