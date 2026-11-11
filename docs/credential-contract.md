# Provider Credential Reference Contract

## Purpose

`src/sandbox/credential-contract.ts` defines only the external reference boundary for
credentials. It does not implement a secret manager, environment injection, a provider
SDK, or token refresh.

## Scope

This contract covers only offline conformance checks before credential injection. It
does not read or inject real credentials.

## Contract

### Allowed data

Each declaration contains only:

- credential name;
- a `secret://...` external reference;
- the minimum scope;
- the maximum TTL (no more than 3600 seconds);
- a mandatory revocation statement.

The contract strictly rejects `value`, `token`, `env_value`, and unknown fields. A
request carries only the name, scope, and TTL, and it verifies that they match the
declaration. No secret contents enter SkillSync reports, fixtures, or the host process.

Reference paths also reject empty segments, `.` and `..` so that external references
cannot be treated as traversable local paths.

## Failure behavior

Any declaration or request that includes rejected fields, mismatched scope or TTL, or
an invalid reference path fails closed.

## Security boundary

This module is an offline conformance check that runs before credential injection. It
does not parse the host environment, read home, connect to a secret manager, start a
provider adapter, or send network requests. Real injection must still happen inside the
provider image only after `runtime-activation-gate`, an independent security review,
and a controlled canary have all passed.

## Verification

Use this contract to verify that only external credential references, bounded scopes,
bounded TTLs, and explicit revocation declarations are accepted before any live runtime
capability is considered.
