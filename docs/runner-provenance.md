# Runner Provenance and Signature Boundary

`skillsync runner validate` can read one detached provenance JSON file while validating
the Runner Config. The provenance file must bind the full `sha256:` image digest, the
Runner protocol and contract version, and the builder and source-code identities.
Unknown fields, oversized files, digest mismatches, and untrusted identities all fail
closed.

Example:

```sh
skillsync runner validate \
  --image ghcr.io/example/runner@sha256:<64-hex> \
  --provenance runner.provenance.json \
  --require-provenance
```

The current implementation performs only local, strict, offline provenance comparison.
It does not access a registry, and it does not treat provenance claims as passwords or
credentials. `--require-signature` explicitly returns
`runner.signature-verification-unavailable` when no separately approved signature
verifier is configured; it does not misreport JSON with a `signature` field as already
verified.

As a result, a current "pass" means that the image Config matches the local provenance
policy. It does not mean that a supply-chain signature has already been verified
cryptographically. Before integrating cosign, Sigstore, or another verifier, review the
verifier binary source, trust roots, network access, certificate policy, and failure
handling separately.
