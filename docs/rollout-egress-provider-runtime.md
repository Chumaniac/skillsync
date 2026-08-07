# Rollout and Rollback Checklist: Runtime Extensions

This checklist is for the future activation of egress, provider adapters, or a
remote/microVM backend. The current release contains only offline contracts and
must continue to use the existing fail-closed Docker/Replay behavior.

The operator procedure for this checklist is [`runtime-operator-runbook.md`](runtime-operator-runbook.md).
Repository workflows do not activate these capabilities: the manual canary
requires `enable_live_capabilities: false`, and the tag-based release workflow
only validates the private package without publishing it.

## Entry criteria

- [ ] Independent security review is approved in
      `docs/security-review-egress-provider-runtime.md`.
- [ ] Deployment bootstrap loads `deployment-config` runtime policy and pins the
      `RuntimeTrustRoot` fingerprint outside request, fixture, Worker, and
      ambient environment data.
- [ ] The deployment satisfies
      `config/runtime-deployment-requirements.schema.json`; the checked-in
      template is reference-only and is not treated as production evidence.
- [ ] Every future live adapter calls `runtime-activation-boundary` before
      allocating a network, credential, Docker/microVM, or Worker capability.
- [ ] The proxy, adapter image, and remote worker each have immutable image
      digests and versioned runner contracts.
- [ ] Provider adapter identity and provider version are checked against an
      external policy file, not only the adapter manifest.
- [ ] No ambient credentials, home directories, Docker sockets, SSH agents, or
      host mounts are present in the worker boundary.
- [ ] Direct-IP, DNS rebinding, redirect, CONNECT, metadata-service, IPv6, and
      proxy-unavailable fixtures pass in controlled CI.
- [ ] Cancellation, client disconnect, worker crash, timeout, retry, and
      deletion-proof fixtures pass for every remote backend.
- [ ] Remote cleanup is bound to the assigned worker/resource and to an event
      digest obtained from an approved Runner evidence boundary.
- [ ] Remote completion and cleanup each carry a verified short-lived Worker
      receipt; digest equality alone is not accepted as source authentication.
- [ ] Public reports are checked for bounded output and secret leakage.
- [ ] A Docker/microVM-enabled canary environment is available; local Docker
      availability is not treated as production evidence.
- [ ] The deployment has an approved operator, an independent security verdict,
      a rollback control, and a redacted evidence review record.
- [ ] The deployment-owned trust root, signed policy bundle, immutable artifact
      digests, provider identity policy, mTLS identity, and Worker receipt keys
      are available through external control-plane references. Their values and
      locations are not stored in this repository.
- [ ] The external secret system can issue scoped short-lived leases and prove
      revocation and deletion without exposing credential values to SkillSync.

## Activation sequence

1. Ship the contract and fixtures with the capability disabled.
2. Enable the backend for an internal canary project only.
3. Verify image, adapter, provider, and runner contract bindings at startup.
4. Verify all egress requests traverse the approved proxy; reject direct
   connectivity and proxy-unavailable fallback.
5. Verify cancellation and teardown evidence before accepting a completed run.
6. Compare bounded findings and resource cleanup against the local backend.
7. Expand access only after the canary evidence is reviewed and recorded.

## Immediate rollback triggers

Roll back to the existing fail-closed backend if any of the following occurs:

- a proxy is unavailable but a request is treated as allowed;
- a request reaches a direct IP, an unapproved redirect, or a metadata service;
- a provider credential is read from ambient process, home, or host state;
- an image, adapter, provider, or runner contract digest/version is missing or
  mismatched;
- a remote run reaches `cleaned` without all deletion proofs;
- raw prompt, token, cookie, header, body, or provider stderr appears in public
  evidence;
- cancellation, timeout, worker crash, or client disconnect leaves resources
  behind;
- any bounded-output security fixture regresses.

## Rollback procedure

1. Disable the experimental backend and reject new runs with a bounded finding.
2. Stop admitting canary traffic; do not fall back to direct network access.
3. Preserve only redacted event evidence and the failing contract fixture.
4. Re-run the local Replay/Docker deny regression suite.
5. Revoke short-lived provider credentials and verify deletion proofs where
   applicable.
6. Record the incident, affected contract version, image digest, and rollback
   reason before proposing another canary.
