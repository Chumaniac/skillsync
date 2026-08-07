# Authoring fixtures

Fixtures are executable product evidence. Each fixture should demonstrate one
behavior and should not depend on the developer's home directory or network.

Recommended layout:

```text
fixtures/
├── invalid/          # structure and safety failures
├── compatibility/    # one capability/profile interaction
├── provenance/       # source and lock shapes
└── semantic-diff/    # before/after Skill pairs
```

Fixture rules:

1. Put a minimal `SKILL.md` at the fixture root.
2. Keep referenced resources inside the fixture unless the fixture is explicitly testing a boundary.
3. Never commit a live symlink to a user's machine or a real secret.
4. A script fixture must only write to a test-controlled temporary path, and tests must assert that the script was not executed by default.
5. If a profile claim changes, add or update the profile fixture and document the evidence URL.

## Behavior preflight fixtures

Behavior fixtures add a strict `behavior.yaml` beside the Skill:

```yaml
schema_version: 1
id: review-basic
description: Review a change without touching sensitive paths.
skill_path: .
required_files:
  - SKILL.md
forbidden_paths:
  - secrets
```

Run the static preflight with:

```bash
skillsync test --fixture fixtures/behavior/review-basic --agent codex --format json
```

The report separates static `preflight-pass` from runtime execution. This
slice always reports `execution: not-run`: it does not invoke an Agent or run
scripts. A future isolated adapter may consume the same fixture contract for
actual behavior evidence.

## Behavior sandbox v2 Replay fixtures

v2 fixtures add an explicit execution contract. The default command remains
static preflight:

```bash
skillsync test --fixture fixtures/behavior/replay-basic --format json
```

Offline Replay requires both flags and never starts an Agent or host process:

```bash
skillsync test --fixture fixtures/behavior/replay-basic --execute --backend replay --format json
```

The v2 manifest is strict. `execution.backend` must be `replay` or `docker`;
Replay requires a fixture-local `replay_trace`, while Docker requires an
immutable `@sha256:<64 hex>` image. Network mode, environment names, limits,
allowed writes, required outputs, forbidden paths, and allowed tools are all
explicit; there are no ambient defaults.

Every v2 manifest starts with:

```yaml
schema_version: 2
```

The checked-in Replay trace is JSONL using the `skillsync.runner.v1` protocol.
The orchestrator binds only the two runtime markers
`__SKILLSYNC_RUN_ID__` and `__SKILLSYNC_INPUT_DIGEST__`; a fixture cannot choose
or reuse a run id. Events are bounded, sequence-checked, redacted before
reporting, and must end with exactly one `run.finished` event.

Replay reports separate `preflight` from `execution`. A passing execution
requires the declared output write, no forbidden path/tool/network/process
event, a complete event stream, and successful teardown. This is evidence of
bounded behavior and reproducibility, not Agent quality certification. Docker
is an opt-in local backend: it requires a running daemon, a locally available
digest-pinned image, and network denial. If any capability is unavailable it
returns code `4`; an image that does not satisfy the [Runner contract](runner-contract.md)
returns `sandbox.image-contract-invalid`; it never pulls an image or falls back
to host execution.
