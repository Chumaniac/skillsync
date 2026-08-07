# SkillSync: Provenance, Compatibility, and Behavior Verification for Agent Skills

SkillSync validates installed Agent Skills, their source, compatibility, and behavior.

```text
gh skill / npx skills handle installation
skillshare / Skills Manager handle synchronization and management
SkillSync verifies the installed content, its source, its compatibility, and its effective behavior
```

## Documentation index

### [SkillSync Complete Design](./SkillSync-Complete-Design.md)

The full product and technical specification, including:

- user problems, goals, and non-goals;
- product positioning and competitive boundaries;
- the `scan / verify / compat / diff / lock / adopt / test / runner / ci` CLI surface;
- the five-layer Verification Contract model;
- the Agent Capability Profile;
- manifests, lockfiles, policy, and security boundaries;
- domain architecture, MVP scope, roadmap, and Definition of Done.

### [Competitive Research and Design Rationale](./Competitive-Research-and-Design-Rationale.md)

The GitHub research and design decision record, including:

- capabilities that current competitors already cover;
- which earlier blue-ocean assumptions no longer hold;
- three product paths and their trade-offs;
- why the recommended direction is a verification layer rather than another synchronizer;
- star-trigger analysis, the unit of community contribution, and open hypotheses to validate.

### [MVP Implementation Plan](./MVP-Implementation-Plan.md)

The task-by-task implementation plan, including:

- file structure and module boundaries;
- domain models and interfaces;
- test-first steps for each task;
- fixture, profile, reporter, CI, and security regression work;
- the final type-check, lint, test, and package acceptance gates.

### [Release Readiness Record](./docs/release-readiness-2026-08-05.md)

The current MVP acceptance record, dogfood conclusions, static quality gates, and the security conditions that real network access, credentials, Docker, microVM, and remote workers must satisfy before enablement.

### [Runtime Capability Activation Gate](./docs/runtime-activation-gate.md)

The fail-closed activation order, mandatory prerequisites, and the exact conditions that must hold before any live runtime capability can be enabled.

### [Runtime Operator Runbook](./docs/runtime-operator-runbook.md)

The operator procedure for activation, revocation, rollback, and evidence review once runtime capabilities are ready to move beyond offline-only preparation.

## Recommended reading order

1. Start with sections 0, 4, 6, 8, 15, and 16 of the complete design document to understand the product claim and MVP boundary.
2. Read the competitive research to see why the project no longer positions itself as "yet another synchronizer."
3. Finish with the implementation plan to map the code tasks.

## Current status

- The original desktop requirements document is external project input and is not published with this public repository. The complete in-repo design baseline is [`SkillSync-Complete-Design.md`](./SkillSync-Complete-Design.md).
- The CLI MVP already implements `scan`, `compat`, `verify`, semantic `diff`, lock verification, adopt planning and explicit lock snapshot apply, fixture-only `test`, and `ci init`. By default it does not execute Skill scripts.
- The current implementation includes structure, digest, source, profile compatibility, semantic diff, policy, and foundational SARIF reporting.
- `test` performs fixture preflight by default. A v2 fixture can run offline Replay only through explicit `--execute --backend replay`, and Docker can be requested explicitly. Docker uses only the local daemon and pre-existing digest-pinned images, and it never pulls automatically or falls back to the host.
- The repository currently ships an inert reference Runner for validating the image contract, Docker lifecycle, and workspace evidence. It does not include provider adapters for Codex, Claude, or similar runtimes.
- `runner validate` can validate Runner Config offline or inspect a local immutable image. Optional provenance validation does not contact a registry and does not misrepresent signed claims as cryptographic verification.
- `runner adapter validate` can validate a Provider adapter manifest offline and bind the adapter/provider version pair to an immutable image digest. It does not accept credential values.
- The credential reference contract can validate secret references, scope, TTL, and revocation declarations offline. It does not read or inject real credentials.
- The egress proxy and remote lifecycle currently exist only as offline contract and simulator coverage so bypass paths, attempt anchoring, retry behavior, and cleanup evidence can be validated first. Real network access, Provider credentials, and remote workers all remain disabled.
- The runtime activation policy, activation boundary, Worker receipt, and readiness canary are prepared, but only as fail-closed prerequisites. They cannot enable real capabilities.
- The external runtime deployment requirements are configured only as schema, a reference-only template, and pure evaluator logic. They declare root, Worker, mTLS, and controlled-environment references only; they do not resolve external credentials and cannot enable live capability.
- Public JSON, text, and SARIF reports replace absolute local paths with `<local-path>` by default and do not emit file contents, environment values, or credentials. `verify` preserves local paths only when a trusted local-debug policy explicitly sets `reporting.include_local_paths: true`; redacted reports still keep the field structure that the `report` command consumes.
- All 4 runtime entrypoints in the current release candidate remain `not-enabled`. The manual canary's only live capability input, `enable_live_capabilities`, defaults to and is enforced as `false`, and the activation order is fixed as `egress -> provider-credentials -> docker-microvm -> remote-worker`.
- The design baseline date is 2026-08-04. External Agent profile evidence is recorded through versioned YAML and official documentation links.

### Local release-candidate validation (2026-08-07)

The most recent validation ran locally and offline inside the repository:

- `npm test`: 69 test files passed, 1 skipped; 426 tests passed, 1 skipped.
- Runtime preparation targeted set: 10 test files and 88 tests passed; simulator evidence was `offline-simulated`.
- type-check, lint, build, `npm pack --dry-run`, 4 workflows, 2 release-template parses, and 20 tracked JSON files (including 3 JSON Schemas) all passed; the public-tree hygiene scan and AST side-effect scan reported no findings.
- Docker reference integration was skipped by the availability gate because no local daemon socket existed. This validation did not use any real endpoint, credential, Docker, microVM, remote Worker, or controlled environment, and it did not present local simulated output as live evidence.

### Source repository and npm package

This project is published as a public source repository at [github.com/Chumaniac/skillsync](https://github.com/Chumaniac/skillsync). [`package.json`](./package.json) already includes `repository`, `homepage`, and `bugs` metadata.

The distributable CLI package is `@chumaniac/skillsync`. Scoped public access is declared in
`package.json`, while the executable remains available as the `skillsync` command.

Tag releases run the full offline validation, inspect the package allowlist, and publish with
GitHub OIDC and npm provenance. The release workflow does not store or use a long-lived npm
token. The package's npm Trusted Publisher must be configured for `Chumaniac/skillsync` and
`.github/workflows/release.yml` before a tag can publish successfully.

### Report privacy boundary

The default `scan`, `compat`, and `verify` outputs do not carry workspace absolute paths into public reports. Path fields are rewritten to `<local-path>`, and any absolute path embedded in Finding messages, SARIF rules, or text remediations is also redacted.

Relative evidence paths, digests, rule codes, and Issue IDs remain available for CI comparison. In a clearly trusted local-debug context that does not leave the machine, the `verify` policy may explicitly set:

```yaml
reporting:
  sarif: true
  include_local_paths: true
```

This option controls only whether local paths are preserved. It does not change the default no-script-execution boundary, the no-network boundary, or the no-credential / no-file-content-output boundary.

## Install from npm

After a tagged release is published, install the CLI globally or run a pinned
version without a global install:

```bash
npm install --global @chumaniac/skillsync
npx --yes @chumaniac/skillsync@0.1.0 --help
```

The executable name is `skillsync` in both cases.

## Quick start

```bash
npm install
npm run build
node dist/cli/index.js scan --path .agents/skills --format json
node dist/cli/index.js verify --path .agents/skills --target codex --format sarif
node dist/cli/index.js verify --path .agents/skills --target codex --policy .skillsync/policy.yaml --format json
node dist/cli/index.js diff --source ./skills-before/review --target ./skills-after/review --format text
node dist/cli/index.js lock --path .agents/skills --format json
node dist/cli/index.js adopt --path .agents/skills --plan
node dist/cli/index.js test --fixture fixtures/behavior/review-basic --agent codex --format json
node dist/cli/index.js test --fixture fixtures/behavior/replay-basic --execute --backend replay --format json
node dist/cli/index.js runner validate --config fixtures/runner/reference-config.json
node dist/cli/index.js runner adapter validate \
  --config fixtures/runner/reference-adapter.json \
  --image skillsync/reference@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --policy fixtures/runner/reference-adapter-policy.json \
  --policy-digest sha256:b76e0c74cd1a10ae01e2749179800e7fe983acb42fceaad07ba9cadfe3c87080
```

## 15-minute trust loop

The offline product example below demonstrates the full trust loop:
`verify -> explain -> fix --plan -> fix --apply -> verify -> report`. It copies only
`fixtures/product/trust-loop/review` into a temporary directory, every plan/apply/report path is explicit, and no Skill script is executed by this flow.

```bash
npm run build

WORKDIR="$(mktemp -d)"
cp -R fixtures/product/trust-loop/review "$WORKDIR/review"
chmod 0777 "$WORKDIR/review/scripts/check.sh"

node dist/cli/index.js verify \
  --path "$WORKDIR/review" \
  --target codex \
  --format json > "$WORKDIR/before.json"

ISSUE_ID="$(node -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const issue=report.issues.find((item)=>item.identity.code==="structure.invalid-script-mode"); if (!issue) process.exit(1); process.stdout.write(issue.id);' "$WORKDIR/before.json")"

node dist/cli/index.js explain "$ISSUE_ID" \
  --path "$WORKDIR/review" \
  --target codex \
  --format json > "$WORKDIR/explain.json"

node dist/cli/index.js fix --plan \
  --path "$WORKDIR/review" \
  --issue "$ISSUE_ID" \
  --format json > "$WORKDIR/plan.json"

node dist/cli/index.js fix --apply \
  --plan "$WORKDIR/plan.json" \
  --yes \
  --backup \
  --format json > "$WORKDIR/receipt.json"

node dist/cli/index.js verify \
  --path "$WORKDIR/review" \
  --target codex \
  --format json > "$WORKDIR/after.json"

node dist/cli/index.js report \
  --before "$WORKDIR/before.json" \
  --after "$WORKDIR/after.json" \
  --plan "$WORKDIR/plan.json" \
  --receipt "$WORKDIR/receipt.json" \
  --format markdown > "$WORKDIR/report.md"
```

`fix --apply` returning `applied` means only that the explicit ActionPlan write succeeded. It does not mean the Skill has passed verification.

Only the next `verify` establishes the after state. Only `report`, built from the before/after JSON pair, can produce a `verified` conclusion. Manual resolutions are shown for review and never invent or overwrite user content; they do not automatically rewrite missing explanations, missing references, or any other content that requires human judgment.

Behavior execution always requires an explicit backend declaration. Replay reads only JSONL events inside the fixture and does not start an Agent, Skill script, subprocess, or network request. Docker requires a local daemon, a pre-existing immutable image that satisfies the [Runner contract](docs/runner-contract.md), and `network.mode: deny`. If those conditions are not met, execution stops with code `4`, and it never pulls an image automatically or degrades to another execution mode.

Build and smoke entrypoints for the Docker reference Runner are documented in [`runner/reference/README.md`](runner/reference/README.md). Real Docker testing requires a local daemon. Standard CI does not depend on Docker; only the manual workflow builds the reference image and runs smoke.

Check whether an existing lock has drifted in content:

```bash
node dist/cli/index.js lock --check --from .agents/.skill-lock.json --path .agents/skills
```

`lock --from` accepts both SkillSync v1 locks and current `npx skills` v3 locks. The raw fields from an external installer are preserved in `metadata.external`. `skillFolderHash` is only a source-directory tree hash and cannot replace the SkillSync `content_digest`; an imported v3 lock can therefore be inspected, but `lock --check` remains fail-closed until the content digest is generated.

By default, `lock` only prints generation or verification results. It does not rewrite the lock file or `SKILL.md`.

Applying an adopt plan requires explicit confirmation and an explicit output file. Replacing an existing file also requires a backup and `--force`:

```bash
node dist/cli/index.js adopt --path .agents/skills --apply --yes \
  --output .skillsync/skills.lock.json
```

Generating CI configuration prints only a plan by default:

```bash
node dist/cli/index.js ci init --target github --path .agents/skills
```
