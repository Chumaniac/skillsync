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

## JUnit test reports (current source)

Build the current source checkout, then export a test report:

```bash
node dist/cli/index.js verify --path ./skills --target codex --format junit > skillsync.junit.xml
node dist/cli/index.js scan --path ./skills --format junit > inventory.junit.xml
```

Upload the XML through your CI's existing test-report step even when verification
returns nonzero; retain that original exit code. This addition is not in the
unchanged npm 0.1.0 or GitHub v0.3.0 archive, and enables no upload or workflow by
itself. Other commands keep their existing format choices.

Each finding is one uniquely named testcase. `fail` becomes a failure;
`warn` and `unknown` become skipped checks, not successful verification. Verify
adds a separate policy testcase: a nonzero policy result fails it, and invalid
input (exit2) is an error. The finding and policy outcomes remain separate; a
policy allowing a failed finding does not relabel that individual finding as a
pass. An empty scan records only inventory completion, not Skill acceptance.

Reports omit raw evidence, prompts and source bodies. Existing path-redaction
policy is honored. XML characters and invalid code points are escaped or
replaced; no DTD or external resources are emitted. Text fields are capped at
2,048 UTF-16 units with an ellipsis. More than 10,000 total testcases or 2 MiB of
UTF-8 XML fails explicitly before any partial report is returned.

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
`--pull=false --network=none`. The no-network rule protects Dockerfile build
instructions. Docker may fetch the exact pinned content as an ordinary build
input. It uses the local immutable image ID only for this controlled smoke:
validation receives the image's local Config through `runner validate --config`,
and the integration test receives that same raw image ID through
`SKILLSYNC_REFERENCE_IMAGE`. This local binding is not an external
`repository@sha256:...` reference. The job does not issue `docker pull` or
supply provider credentials. This does not turn package/image acquisition by
GitHub Actions into a live SkillSync runtime capability. The remote/microVM job
verifies only the offline protocol contract; it does not claim a live Worker or
microVM canary.

Deployment requirements are checked as a reference-only declaration. The canary
does not resolve deployment key-store or mTLS references, and a template with
placeholders is intentionally not accepted as production evidence.

## Release validation

`.github/workflows/release.yml` runs only for tags matching `v*`. It requires the
exact tagged source to have a successful main repository verification, then
checks tests, types, lint, build and the actual public package allowlist. It
publishes a tarball, checksums, validated SBOM and source manifest to GitHub
Releases only after required GitHub provenance succeeds. Existing releases are
not overwritten. This distribution needs no npm account or long-lived token;
the npm registry remains at 0.1.0. A tag does not activate a live runtime.

The operator-facing activation, revocation, rollback, and evidence review
procedure is in [`runtime-operator-runbook.md`](runtime-operator-runbook.md).


## Installation channel and source capabilities (current main)

`skillsync capabilities --json` inspects the installed build manifest and this CLI's declared capabilities without network, Skill execution or history writes. A missing/changed manifest remains unconfirmed; a source revision or capability list is not apply, runner or export permission. `--expect-source <40-character-commit>` additionally refuses an unknown, locally changed or different build. The build manifest records the version, immutable source revision, local-change flag and capability list; normal `npm run build`/`npm pack` produces it. A direct `tsc` invocation without that step cannot claim a build identity.

Channel observations are dated, not refreshed implicitly. On 2026-11-06 the npm default remains published `@chumanic/skillsync@0.1.0`, GitHub's release remains `v0.3.0`, and current source includes JUnit, acceptance batches and tracked workbench operations beyond those fixed downloads. Local `0.3.0` source tarballs do not mean npm0.3.0 was published. The current command reports that the default CI pin only asserts the published verify/SARIF interface; it does not claim current-source extensions for that pin. A custom npm version is the user's explicit selection, not a live availability check.

The default template and pre-commit hook keep their existing npm pin. To build a reviewed current source commit in a GitHub consumer workflow instead:

```sh
skillsync ci init --target github --source github-source \
  --source-revision FULL_40_CHARACTER_LOWERCASE_COMMIT --path .agents/skills
```

Replace the placeholder with a real full commit containing this capability command. Branches/tags, missing/invalid commits, conflicting npm/version flags and source-channel pre-commit hooks are refused; `ci init` itself performs no fetch or write unless `--apply` is given. Existing output requires `--force`; concurrent default applies cannot overwrite each other, and output links are refused.

The generated source workflow fetches only the fixed public SkillSync repository into a new runner temporary directory, checks the exact HEAD, installs its lockfile with `npm ci --ignore-scripts`, explicitly builds that selected trusted source, and checks `capabilities --expect-source` before verify. Pinning source is a deliberate code-trust decision: review the selected source and its locked dependencies. No Skill instruction or Skill script is executed. An old commit without the capability command fails this preparation gate; no fallback silently uses another channel. Missing dependencies or fetch failures stop rather than weakening the pin.

The consumer keeps the existing verify exit status and SARIF upload step/permissions. This source option adds no additional report destination; local validation does not run an upload action. The generated command addresses Skill paths in the consumer workspace, while the CLI build remains outside it. Nothing automatically replaces a user's current CI file, upgrades npm, publishes a package or enables a live runtime.
