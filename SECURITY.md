# Security Policy

SkillSync is a verification and evidence tool. It is not a security certification and cannot prove that a third-party Skill, Agent, provider, or external runtime is safe.

## Reporting a vulnerability

Please do not open a public issue for an undisclosed vulnerability. Use the repository's GitHub Security Advisories / private vulnerability reporting channel when it is enabled. Include a minimal reproduction, affected version or commit, impact, and a suggested mitigation. Do not include credentials, private files, or complete secret values in the report.

If private reporting is not enabled, contact the repository maintainers through the private channel listed in the repository's GitHub security settings before disclosure.

## Scope

The most important security boundaries are:

- default commands do not execute Skill scripts, access the network, or read ambient credentials;
- Replay execution is fixture-local and deterministic;
- Docker execution is opt-in, digest-pinned, network-denied, non-root, bounded, and never falls back to host execution;
- real provider credentials, allowlist networking, microVMs, and remote Workers remain disabled until independently reviewed in a controlled environment;
- reports must remain bounded and must not contain file contents, prompts, environment values, or credentials.

See [docs/security-boundary.md](docs/security-boundary.md) for the detailed contract and [docs/runtime-activation-gate.md](docs/runtime-activation-gate.md) for the future live-capability gate.

## Supported versions

Only the latest published release and the default branch receive security fixes. Please upgrade to the latest version before reporting an issue that is already fixed on the default branch.
