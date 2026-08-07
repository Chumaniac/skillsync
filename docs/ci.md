# CI integration

SkillSync can generate a read-only GitHub Action or a local pre-commit hook.

```bash
skillsync ci init --target github --path .agents/skills
skillsync ci init --target pre-commit --path .claude/skills .agents/skills
```

The default is plan mode: the command prints the file and does not write it. Add
`--apply` to write the requested file. Existing files require `--force` before
they can be replaced.

The generated GitHub Action grants `contents: read` and uploads SARIF findings;
it does not execute Skill scripts. The generated consumer command pins the
published SkillSync package version (`@chumanic/skillsync@0.1.0` by default); override it
with `ci init --package-version <version>` when upgrading. Because the current
repository publishes a scoped public package, the generated consumer template can
be used after that package version is available; the repository's own workflow uses
the checked-out build instead.

The repository's own `.github/workflows/skillsync.yml` runs the offline regression
and verifies the checked-in `fixtures/behavior/review-basic` fixture on pull
requests, pushes to `main`, and manual dispatch. It is intentionally different
from the generated consumer workflow: it validates SkillSync's implementation
and public-tree hygiene rather than assuming that this repository contains a
user's `~/.agents/skills` or `~/.claude/skills` directory.

The default regression also runs the live-runtime preparation integration and
documentation tests. Its package step is `npm pack --dry-run`; it does not publish
or resolve any deployment-owned reference.

## Runtime canary contracts

`.github/workflows/skillsync-runtime-canary.yml` is manual-only and requires a
named GitHub Environment so the canary evidence has an explicit owner. Its
default path runs only offline egress, credential-reference, activation-gate,
remote-lifecycle, remote-receipt, activation-boundary, deployment-requirements,
readiness, side-effect, type-check, and lint checks.

The manual runtime canary also requires `enable_live_capabilities: false`. Its
readiness job fails if that value changes, and both the optional Docker reference
smoke and remote/microVM contract jobs depend on the readiness job. This is a
preparation gate, not a live activation switch.

The contract-preflight job includes the runtime ports, evidence-mode,
reference-provider, egress, microVM, remote Worker, runtime-orchestrator, and
live-runtime-preparation tests. These are deterministic offline contracts and
must continue to report `offline-simulated` evidence. The Docker reference
smoke remains opt-in and is the only canary step that may use the local Docker
daemon.

The optional Docker job builds the reference image locally with
`--pull=false`, binds validation to the image ID, and runs the digest-pinned
smoke fixture. The controlled runner must pre-seed the base image; if it is not
available locally, the build fails rather than falling back to an unreviewed
registry path. The job does not issue `docker pull` or supply provider
credentials. The remote/microVM job verifies only the offline protocol
contract; it does not claim a live Worker or microVM canary.

Deployment requirements are checked as a reference-only declaration. The canary
does not resolve deployment key-store or mTLS references, and a template with
placeholders is intentionally not accepted as production evidence.

## Release validation

`.github/workflows/release.yml` runs only for tags matching `v*`. It checks the
test suite, type-check, lint, build, and `npm pack --dry-run`, then publishes
`@chumanic/skillsync` with `npm publish --provenance --access public`. The job
uses GitHub OIDC (`id-token: write`) and no long-lived npm token. npm Trusted
Publisher configuration is an external prerequisite; a tag is not permission
to activate a live runtime capability.

The operator-facing activation, revocation, rollback, and evidence review
procedure is in [`runtime-operator-runbook.md`](runtime-operator-runbook.md).
