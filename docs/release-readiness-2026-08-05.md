# SkillSync Release Readiness Record (2026-08-05)

## Conclusion

SkillSync's MVP product capability has reached Local release candidate status: scanning,
drift detection, compatibility, semantic diff, verify output, fixtures, templates, and
the default read-only boundary are all implemented and have passed regression
verification.

This stage does not claim that third-party Skills can be executed safely. The Runner,
egress, provider adapter, and remote Worker have fail-closed contracts and simulated
lifecycle coverage in place, but real network access, credentials, Docker, microVM, and
remote Workers remain disabled.

## Readiness matrix

| Scope | Status | Evidence or notes |
| --- | --- | --- |
| MVP product acceptance checklist | Pass | Section 19 of `SkillSync-Complete-Design.md`; CLI, fixture, and documentation tests |
| Default read-only and no-side-effect boundary | Pass | `tests/security/contracts-no-side-effects.test.ts` |
| Egress fail-closed contract | Pass | 30 focused tests, including request binding, IP literals, private/local resolved addresses, and redirect revalidation |
| Provider adapter identity binding | Pass | 9 focused tests; both image and identity policy come from external inputs |
| Runtime capability activation-order gate | Local pass, pending review | `src/sandbox/runtime-capability-gate.ts`; 6 focused tests; executes no runtime side effects |
| Deployment policy bootstrap | Local pass, pending review | Root fingerprint, trust bundle, and deployment-config source; 8 focused tests |
| Activation boundary | Local pass, pending review | Must reject without policy; records capability in order; starts only after authorization and rejects forged or tampered boundaries; 7 focused tests |
| Credential reference contract | Local pass, pending review | Accepts only a secret reference, scope, TTL, and revocation declaration; 8 focused tests; rejects values |
| Remote Worker receipt contract | Local pass, pending review | Ed25519, 1-hour maximum TTL, expiry, and run/attempt/resource/digest binding; 4 focused tests |
| Activation readiness | Prepared | Non-live readiness evaluator and manual canary; 5 focused tests |
| External deployment requirements | Contract prepared | Schema, reference-only template, pure parser/evaluator; 15 focused tests; does not parse root or Worker references |
| Controlled canary workflow | Prepared | Manual workflow; runs full offline runtime simulator contracts by default, optional local reference Docker smoke, no credential injection; `enable_live_capabilities` defaults to `false`, and the job rejects any value other than `false` |
| Release validation workflow | Prepared | `v*` tags run test, type-check, lint, build, package inspection, and OIDC-backed public npm publication with provenance; no long-lived npm token is used |
| Runtime operator runbook | Prepared | Covers activation order, revocation, rollback, evidence review, and deployment-owned external prerequisites; contains no real endpoint or secret location |
| Remote lifecycle and cleanup proof | Local pass, pending review | 17 focused tests; secure mode validates strictly and requires a Worker receipt; retries must clean up the current attempt first |
| Dogfood results | Recorded | `docs/dogfood-2026-08-05.md`; known issues reserved to the user directory were found and not rewritten automatically |
| Runtime entrypoints and live input | Kept disabled | All 4 entrypoints in the deployment template/schema remain `not-enabled`; the only live workflow input remains false-only; activation order remains `egress → provider-credentials → docker-microvm → remote-worker` |
| Full regression | Pass | `npm test`: 68 test files passed, 1 skipped; 400 passed, 1 skipped; Docker reference integration remains skipped behind availability gating |
| Static checks and packaging | Pass | Local type-check, lint, build, and `npm pack --dry-run` all passed; package dry-run listed 262 package files and did not publish |
| Docker integration | Pending controlled environment | Docker integration opt-in was not enabled in this run, so Docker was not executed; the historical record "Docker daemon remains unavailable" is not used as current live evidence |
| independent security review | Not approved | Preparation is complete; root-pin source, live execution-path wiring, Worker key/mTLS, and controlled canary still require external approval |

## Task 7 local release-candidate review (2026-08-06)

This section records only fresh local offline evidence from the release-candidate
checkout. It does not describe local contract or simulator results as controlled
environment, production network, or remote Worker evidence. No real endpoint,
credential, Docker daemon, microVM, or remote Worker was used in this review.

| Review item | Fresh result |
| --- | --- |
| Full test suite | `npm test`: 68 test files passed, 1 skipped; 400 tests passed, 1 skipped |
| Focused runtime-preparation tests | 7 test files and 61 tests all passed; provider and egress evidence remained `offline-simulated` |
| Type, lint, and build | `npm run type-check`, `npm run lint`, and `npm run build` passed locally |
| Workflow YAML | 4 `.github/workflows/*.yml` files parsed successfully |
| JSON/schema | 20 tracked JSON documents parsed successfully, including 3 JSON Schemas |
| Public-tree hygiene | No hits for personal paths, secret-like values, `.env`, or key/certificate/keystore files |
| Source side effects | The AST side-effect suite passed 20 tests |
| Live boundary | All 4 live entrypoints remain `not-enabled`; the only `enable_live_capabilities` input is still constrained to false-only by the workflow |
| Package/diff review | The package dry-run contained only public allowlist paths; the full diff contained only the four documentation files in Task 7 and no raw credentials, private paths, or generated artifacts |

These results show that release-candidate preparation remains aligned with fail-closed
boundaries. They do not replace independent security approval, controlled Docker/microVM
validation, real egress/provider/credential review, or remote Worker authentication
evidence.

## Release boundary

What can be delivered today is a local, auditable, default-read-only Skill asset
governance tool. The following capabilities remain disabled until they receive separate
threat modeling, independent approval, and controlled CI evidence:

- real agent network access and redirect following;
- provider-adapter images and short-lived credential injection;
- Docker allowlist networking and microVM execution;
- remote Workers, resource deletion, and tenant isolation.

Task 6 also keeps release and canary validation at the preparation layer: all simulator
evidence is explicitly labeled `offline-simulated`, Docker smoke still requires explicit
opt-in, and the release workflow performs only verification and package dry-run. The
deployment-owned prerequisites listed in `docs/runtime-operator-runbook.md` cannot be
replaced by workflow, fixture, or package artifacts in the repository.

## Entry conditions for the next stage

1. An independent reviewer records a clear verdict in `docs/security-review-egress-provider-runtime.md`.
2. Run the Docker/microVM integration fixture in controlled CI and validate the isolation
   of network, credentials, logs, and cleanup.
3. Enable only one capability at a time, bound to an immutable image, policy, audit
   evidence, and rollback switch.
4. Update the unchecked rollout gates only after the canary passes.

## M1 report privacy-boundary review (2026-08-07)

This stage fixed the unwired report policy and the inverted default. Reports no longer
expose absolute local paths by default, and `reporting.include_local_paths` preserves
paths only when it is explicitly set to `true` for trusted local debugging output. The
Finding message, remediation, and path fields in JSON, text, and SARIF all pass through
the same redaction boundary. The redacted result preserves the report field structure
and relative evidence paths, so the `report` command can still consume it.

| Review item | Result |
| --- | --- |
| Path-redaction regression | `tests/cli/scan.test.ts`, `compat.test.ts`, `verify.test.ts`, and reporter tests passed |
| Full test suite | `npm test`: 68 test files passed, 1 skipped; 419 tests passed, 1 skipped |
| Type and lint | `npm run type-check` and `npm run lint` passed |
| Default policy | `verify` now outputs `reporting.include_local_paths: false` by default, and local absolute paths are replaced with `<local-path>` |
| Explicit exception | `include_local_paths: true` in YAML policy restores path retention only; it does not restore full file contents or credential output |

This stage still does not change the disabled state of real network access, provider
credentials, Docker/microVM, or remote Workers. Those capabilities continue to wait for
independent security approval and controlled-environment evidence.

## M2 local deliverability review (2026-08-07)

This stage completed the local closeout for lock/CI/package delivery: `lock --from` can
import the current `npx skills` v3 lock while preserving the original installer fields;
the directory-tree `skillFolderHash` is not treated as a content digest, and checks fail
immediately when the SkillSync digest is missing. The generated consumer CI templates pin
the package version. The install entrypoint resolves the real path so that macOS `/var`
symlinks do not make the installed CLI exit silently.

| Review item | Result |
| --- | --- |
| Lock v3 interoperability | Domain and CLI lock tests passed; external fields remain in `metadata.external` |
| CI templates | GitHub and pre-commit commands pin `skillsync@0.1.0`; the pre-publish requirement from `private: true` remains explicit |
| Clean install | The local `npm pack` tarball installed into a fresh temporary directory; help and `scan --format json` both succeeded |
| Full regression | `npm test`: 68 test files passed, 1 skipped; 422 tests passed, 1 skipped |
| Static gates | `npm run type-check`, `npm run lint`, `npm run build`, and `git diff --check` passed |

This stage did not run `npm publish`, Git push, real network access, credentials,
Docker/microVM, or remote Workers.

## M3 offline runtime and release-candidate acceptance (2026-08-07)

This stage validates only the existing fail-closed runtime contracts, release package,
and config parsing in the repository. It does not enable any real capability.

| Review item | Result |
| --- | --- |
| Runtime preparation | All 10 focused test files and all 88 tests passed; evidence remains `offline-simulated` |
| Workflow/template parsing | 4 workflows and 2 CI templates parsed successfully |
| JSON/schema parsing | 20 tracked JSON files parsed successfully, including 3 JSON Schemas |
| Package dry-run | `npm pack --dry-run` passed; 265 package files; not published |
| Docker gate | No local daemon socket exists, the reference integration remains skipped, and execution did not start, bypass, or degrade to the host |

M3 proves only that the offline preparation layer is deliverable. Controlled
Docker/microVM, real egress/provider flows, credential revocation, and remote Worker
authentication remain later external gates.

## M4 public source-repository delivery (2026-08-07)

This stage completed closeout for a public source repository: the GitHub repository is
public, package metadata points to the repository and issue entrypoint, and contributors
use consistent LF text newlines whether they commit from different operating systems or
through the GitHub web UI. npm publish remains explicitly disabled so that a public
source repository is not confused with a published npm package.

| Review item | Result |
| --- | --- |
| Public repository | `https://github.com/Chumaniac/skillsync` is public and `main` can be read |
| Open-source governance | MIT, contributor guide, security policy, code of conduct, Issue templates, PR template, and CI are all in the repository |
| Package metadata | `repository`, `homepage`, and `bugs` point to the public repository; `private: true` remains |
| GitHub Actions | After the fix, `regression` and `verify` pass in the `main` push workflow; SARIF has been accepted by Code Scanning, and the upload action uses CodeQL v4 |
| Release boundary | `npm publish`, real network access, credentials, Docker/microVM, and remote Workers were not executed |

M4 reaches a public-source delivery state that is ready for collaboration, review, and
local verification. npm package publication and real runtime capabilities still require
their own separate release and security gates.

## M5 default-branch closeout (2026-08-07)

The public documentation migration was delivered through [PR #1](https://github.com/Chumaniac/skillsync/pull/1)
and merged into the default `main` branch as `a99503d`. The repository's default
download path now contains the canonical English documentation, documentation tests,
and updated workflow filters.

| Review item | Result |
| --- | --- |
| Default branch delivery | Pass | `main` contains the merged English documentation migration |
| Remote CI | Pass | `skillsync`, `regression`, and `verify` checks passed |
| Current local evidence | Pass | 69 test files passed, 1 skipped; 426 tests passed, 1 skipped; type-check, lint, build, and package dry-run passed |
| npm publication | Intentionally pending | `private: true` remains; npm publication requires a separate release decision |
| Live runtime enablement | Intentionally pending | Independent security approval and controlled-environment evidence remain mandatory |

## M6 npm package release preparation (2026-08-07)

The package release track now targets the scoped public package
`@chumanic/skillsync`. The package metadata, generated consumer templates, and
tag workflow are aligned. Publication uses GitHub OIDC and npm provenance rather
than a long-lived registry token; the npm Trusted Publisher configuration remains
an external one-time setup for the package owner.

| Review item | Result |
| --- | --- |
| Package identity | Prepared | `@chumanic/skillsync@0.1.0`; the unscoped `skillsync` name is already occupied by another package |
| Public access | Prepared | `private: false` and `publishConfig.access: public` |
| Consumer templates | Pass | GitHub Action and pre-commit templates pin `@chumanic/skillsync@0.1.0` |
| Release workflow | Prepared | Tag validation runs on Node 24, then publishes with OIDC and provenance; no npm token is stored in GitHub |
| npm Trusted Publisher | Pending owner setup | Configure user `Chumaniac`, repository `skillsync`, workflow `.github/workflows/release.yml`, and allow `npm publish` |
| First publication | Pending authentication | Requires an authenticated npm account that owns the `@chumanic` scope |

This package track does not change the offline-first product boundary. Real
network access, provider credentials, Docker/microVM execution, and remote Worker
execution remain disabled pending the independent security and controlled-runtime
gates above.

## M7 npm publication closeout (2026-08-08)

The initial public package release is now available as
`@chumanic/skillsync@0.1.0`. The package was published interactively after the
release checks passed and was verified from a clean consumer directory.

| Review item | Result |
| --- | --- |
| Public registry metadata | Pass | Anonymous registry lookup resolves version `0.1.0` with the `latest` tag |
| Clean consumer install | Pass | `npm install --ignore-scripts @chumanic/skillsync@0.1.0` completed successfully |
| CLI smoke test | Pass | The installed `skillsync --help` command rendered the public command list |
| Package audit | Pass | The clean install reported zero vulnerabilities |
| npm Trusted Publisher | Pending owner setup | Configure user `Chumaniac`, repository `skillsync`, workflow `release.yml`, and allow `npm publish` |
| Future tag publication | Pending owner setup | The GitHub OIDC/provenance workflow is ready, but the npm Trusted Publisher must be configured before publishing a future tag |

This closeout confirms public distribution and local consumer usability. It does
not approve live network access, provider credentials, Docker/microVM execution,
or remote Worker execution; those remain separate security and controlled-runtime
gates.
