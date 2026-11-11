# SkillSync Runner Image Contract

## Purpose

The repository also provides a reference Runner with no provider, no network access,
and no write behavior at `runner/reference/`. It exists only to validate the Docker
lifecycle, protocol boundary, and security metadata. It reads `SKILL.md` as data, does
not execute a Skill, and does not represent the quality or compatibility of any Agent.
See [`runner/reference/README.md`](../runner/reference/README.md) for the reference
image build and the local smoke entrypoint.

## Scope

Use `skillsync runner validate --config <path>` to check a Docker Config offline, or
use `skillsync runner validate --image <name@sha256:digest>` to check a local immutable
image. Image validation does not execute `docker pull`. When supply-chain evidence is
required, add `--provenance <path> --require-provenance`; signature verification still
requires an explicitly configured reviewed verifier and does not treat a signature claim
as verified by default.

The Docker backend does not concatenate Agent or provider commands directly. An image
must expose a black-box entrypoint and emit bounded behavior evidence through
`skillsync.runner.v1` JSONL.

Provider adapters additionally require
`runner adapter validate --config <path> --image <immutable-ref> --policy <path>`,
where both the image and the identity policy are trust inputs outside the manifest.

## Contract

### Image requirements

Images must use immutable references:

```text
<registry>/<image>@sha256:<64 hex>
```

The Config from `docker image inspect --format '{{json .Config}}' <image>` must contain:

```json
{
  "Labels": {
    "org.skillsync.runner.protocol": "skillsync.runner.v1",
    "org.skillsync.runner.contract": "1",
    "org.skillsync.runner.entrypoint": "/usr/local/bin/skillsync-runner"
  },
  "Entrypoint": ["/usr/local/bin/skillsync-runner"],
  "Env": ["PATH=/usr/local/bin:/usr/bin:/bin"]
}
```

The only allowed static environment names are `PATH`, `LANG`, `LC_ALL`, and `TZ`. A
fixed `PATH` must exist. `HOME`, proxies, the Docker socket, SSH agent settings,
AWS/OpenAI/Anthropic credentials, and variables containing `TOKEN`, `KEY`, `SECRET`, or
`PASSWORD` invalidate the contract.

When SkillSync creates the container it enforces:

```text
--entrypoint /usr/local/bin/skillsync-runner
```

The image's default entrypoint therefore cannot bypass the Runner contract.

### Runner input

The container working directory is `/workspace`. SkillSync passes only these explicit
variables:

```text
SKILLSYNC_PROTOCOL=skillsync.runner.v1
SKILLSYNC_RUN_ID=<run UUID>
SKILLSYNC_INPUT_DIGEST=sha256:<64 hex>
SKILLSYNC_AGENT=<agent name>
SKILLSYNC_SKILL_PATH=skill
```

It does not inherit the host environment or mount home, credentials, an SSH agent, the
Docker socket, or devices. The Runner must read the Skill from `/workspace/skill`.

### stdout, stderr, and exit codes

- stdout may contain only UTF-8 `skillsync.runner.v1` JSONL with no mixed-in logs,
  prompts, file contents, or credentials;
- each line is limited to 64 KiB, the total event count to 10,000 events, and the total
  stdout size to 8 MiB;
- stderr is diagnostic-only, SkillSync retains at most 64 KiB of it, and it is not
  written into public reports;
- the first event must be `run.started`, and the last event must be `run.finished`;
- every event must use the current `SKILLSYNC_RUN_ID` and input digest;
- `run.finished.payload.exitCode` must match the container process exit code;
- `passed` must use exit code `0`, and `failed` or `blocked` must use the corresponding
  non-zero exit code.

## Failure behavior

Contract violations return `sandbox.image-contract-invalid` with exit code `4`.
Protocol-invalid output, output-limit violations, exit-code mismatches, or timeouts are
execution failures that return exit code `1`. SkillSync does not automatically pull an
image and does not fall back to Replay or to the host process.

## Security boundary

Public reports retain only event counts, written paths/bytes/digests, tool names,
network decisions, event digests, and teardown status. Provider text, stderr, prompts,
file contents, environment values, and credentials do not cross the report boundary.

## Verification

Validate the image contract offline with `skillsync runner validate`, and validate
adapter-specific identity requirements with `runner adapter validate` before any live
runtime capability is enabled.
