# Runtime Operator Runbook

This runbook describes the controlled deployment procedure for a future egress,
provider-credential, Docker/microVM, or remote Worker capability. The repository
currently provides offline contracts and simulators only. The manual canary is
not an activation switch, and every local simulator reports
`offline-simulated` evidence.

## External prerequisites

Activation is blocked until every item below has an owner and an auditable,
deployment-owned record. The record may contain references and digests, but
must not be copied into this repository.

1. An independent security review has approved egress policy enforcement,
   credential leasing, runner isolation, activation-boundary enforcement,
   Worker authentication, cleanup proofs, and report redaction.
2. A deployment-owned `RuntimeTrustRoot` is pinned by fingerprint, with signed
   review, environment, and activation policy bundles and a defined rotation
   procedure.
3. The deployment configuration satisfies
   `config/runtime-deployment-requirements.schema.json` and is loaded from the
   deployment control plane. Key-store, mTLS, and controlled-environment
   entries are external references; no key, certificate, token, or endpoint
   value is stored in SkillSync.
4. Immutable digests and external identity-policy bindings exist for the proxy,
   provider adapter, Runner image, microVM guest image, and remote Worker. The
   provider version must be checked against the external identity policy.
5. The external secret system can issue a scoped, short-lived lease for each
   declared credential, enforce its maximum TTL, revoke it, and provide a
   deletion or revocation proof. SkillSync receives only the secret reference identity,
   scope, TTL, lease digest, and proof status.
6. The controlled environment denies direct network access, provides the
   approved proxy, blocks metadata and rebinding paths, and has no host home,
   credential mount, SSH agent, device, Docker socket, or broad host mount.
7. The runner or microVM enforces bounded CPU, memory, process count, output,
   timeout, and teardown behavior. The remote Worker additionally provides
   short-lived authenticated completion and cleanup receipts bound to the run,
   attempt, resource, image, input, and event digests.
8. A deployment-owned rollback control can reject new runs, disable the current
   capability, revoke active leases, and return to the previously approved
   capability state without direct-network or host-process fallback.
9. An evidence owner and reviewer are assigned. Evidence storage accepts only
   redacted bounded records and preserves the contract version, artifact
   digests, capability state, receipt status, cleanup status, and decision.

## Activation

The activation order is fixed and must not be reordered:

`egress → provider-credentials → docker-microvm → remote-worker`

For each capability, keep the state transition explicit:

`not-enabled → prepared → canary-approved → enabled`

1. Record the baseline: run the offline contract suite, verify all evidence is
   `offline-simulated`, confirm `enable_live_capabilities: false` in repository
   workflows, and record the approved artifact and policy digests.
2. Enable egress for one internal canary scope. Verify proxy availability,
   host and IP policy, DNS revalidation, redirect scope, metadata blocking,
   bounded audit output, cancellation, and timeout evidence.
3. After egress evidence is approved, enable provider credentials. Issue only
   the external scoped lease required by the canary, verify the reference and
   TTL binding, and verify revocation/deletion proof before accepting results.
4. After credential evidence is approved, enable exactly one Docker or microVM
   runner. Verify immutable image binding, deny-by-default network behavior,
   resource limits, absence of host mounts, teardown, and bounded reports.
5. After runner evidence is approved, enable the remote Worker. Verify mTLS or
   the deployment-owned Worker identity, authenticated completion and cleanup
   receipts, attempt/resource binding, cancellation, retry cleanup, and stale
   receipt rejection.
6. Promote only after the evidence reviewer records the decision and rollback
   owner. Never promote two capabilities in the same change window.

The repository's manual canary may run the offline contract set and the
explicitly opt-in local Docker reference smoke. It does not resolve any of the
external prerequisites above or create a live endpoint, credential lease,
microVM, or remote Worker.

## Revocation

Revoke a capability when its evidence expires, a policy binding changes, an
operator loses confidence, or any rollback trigger is met.

1. Stop admitting new canary runs and mark the capability as blocked.
2. Disable the capability at the deployment boundary; do not replace it with
   direct network access or a host-process fallback.
3. Revoke every active credential lease through the external secret system and
   collect revocation/deletion proofs.
4. Cancel active runs, tear down the exact assigned runner or Worker resource,
   and verify cleanup evidence for each attempt.
5. Preserve only redacted bounded evidence: run and attempt identifiers,
   capability state, artifact/policy digests, finding codes, receipt status,
   cleanup status, and timestamps.
6. Return to the last approved state, normally `not-enabled` or the existing
   fail-closed Replay/Docker path, and record the revocation reason.

## Rollback

Rollback immediately if a proxy-unavailable request is allowed, a direct or
disallowed destination is reached, a credential value is read from ambient
state, an artifact or identity binding is missing, cleanup or deletion proof is
missing, a receipt is stale or mismatched, or bounded evidence contains a
secret, prompt, cookie, header, file content, or unrestricted provider output.

1. Reject new runs for the affected capability.
2. Disable it at the deployment boundary and revoke active leases.
3. Cancel and tear down exact resources, recording any cleanup failure as a
   blocking finding.
4. Restore the prior fail-closed capability state and rerun the local offline
   contract, side-effect, and report-redaction checks.
5. Review the redacted incident evidence, contract version, artifact digests,
   and rollback decision before reopening any canary.

## Evidence review

The reviewer must confirm all of the following before approving a state change:

- capability order and state transition match the activation sequence;
- evidence mode is explicit and is not misrepresented as live evidence;
- request, policy, image, adapter, provider, resource, event, and receipt
  digests are bound to the same run and attempt;
- egress decisions include proxy status, destination policy, redirect/DNS
  revalidation, and bounded audit records;
- credential evidence contains only reference identity, scope, TTL, lease
  digest, and revocation/deletion status;
- runner and Worker evidence includes resource teardown and cleanup proofs;
- no report contains prompt/model text, file contents, environment values,
  authorization material, cookies, secret values, private paths, or real
  endpoint data;
- failures remain fail-closed and the rollback owner has acknowledged them.

Store the review decision with the redacted evidence and the external record
identifiers. Do not store secret locations, secret values, private keys, live
endpoint URLs, or unredacted provider output in SkillSync issues, artifacts,
reports, commits, or package contents.
