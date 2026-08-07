# Provider Adapter Conformance

Provider adapter manifests describe the executable that lives inside a Runner
image. They bind adapter identity, provider version, image digest, Runner
protocol and contract version without moving provider SDKs or credentials into
the SkillSync host process.

Validate an adapter manifest offline:

```sh
skillsync runner adapter validate \
  --config fixtures/runner/reference-adapter.json \
  --image skillsync/reference@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --policy fixtures/runner/reference-adapter-policy.json \
  --policy-digest sha256:b76e0c74cd1a10ae01e2749179800e7fe983acb42fceaad07ba9cadfe3c87080
```

The external immutable image reference and an external identity policy are
required. The CLI never treats the manifest's self-declared digest, adapter
version, or provider version as its own trust anchor:

```sh
skillsync runner adapter validate \
  --config adapter.json \
  --image ghcr.io/example/adapter@sha256:<64-hex> \
  --policy adapter-policy.json \
  --policy-digest sha256:<64-hex>
```

`--policy-digest` is computed over the exact policy file bytes and is an
independent trust binding; a policy file that is changed after review fails
before adapter identity comparison.

The manifest can declare `credentials.mode: explicit-short-lived`, credential
names, and a maximum lifetime. It never accepts credential values. The
conformance layer does not fetch images, contact providers, read host
environment variables, or claim that a provider is secure; it only proves that
the adapter's declared identity and protocol boundary match the externally
bound immutable image and policy.

`network.mode: proxy-required` is declarative only until the separately
reviewed egress proxy is available. A missing proxy must not degrade to direct
network access.

## Offline reference adapter

`createReferenceProviderAdapter()` is an inert `ProviderAdapterPort` implementation
for contract and integration tests. It replays the checked-in
`fixtures/runner/reference-provider-events.jsonl` trace after binding the
request's run and input digests. The matching normalized request is recorded in
`fixtures/runner/reference-provider-request.json`.

The adapter validates the immutable adapter/provider identity and the skill,
policy, and image digests before replay. It parses every event with the Runner
`skillsync.runner.v1` contract, rejects malformed or oversized output, computes
the event and redacted-evidence digests from the emitted events, and marks the
result `evidenceMode: "offline-simulated"`. An already-cancelled request, or a
request cancelled during replay, returns bounded `blocked` evidence with a
completed local cleanup record.

This reference implementation does not open sockets, read ambient environment
values or external references, start a process, load a provider SDK, or execute
the host. It rejects raw credential values at the normalized request boundary;
credential references are identifiers only and are never resolved. It is not a
provider-quality certification and cannot enable live capability: both
`liveCapabilitiesEnabled` and `enable_live_capabilities` remain `false`.
