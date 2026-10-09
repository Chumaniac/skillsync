# Changelog

## 0.1.5 source candidate - 2026-10-09

- Add bounded per-key integer reconciliation across physical CSV files. Split
  deliveries pass; balanced but wrongly allocated values, missing/extra keys,
  overflow and exhausted indexes fail without exposing IDs or values. Reject
  same-file declarations before reading delivery files.
- Add source-only synthetic allocation fixtures and a full expansion roadmap.
  Existing physical, reference, coverage and summary rules remain in place.
- Derive CLI and report versions from the installed package metadata. Public
  GitHub v0.1.4 and npm0.1.0 remain unchanged; this candidate is not published.

## 0.1.4 - 2026-10-09

GitHub release run `37897733439` succeeded. Downloaded package/SBOM/manifest
checksums and asset digests matched; isolated installation and the packaged
synthetic delivery-coverage check passed with `execution: not-run`.

- Publish new tagged packages through GitHub Releases with SHA256 checksums,
  validated CycloneDX SBOM and required GitHub provenance, without an npm account.
- Keep npm-based CI defaults on the actually public 0.1.0 package; source and
  GitHub packages retain artifact/reference/target coverage capabilities.
- Preserve the earlier immutable tags and npm 0.1.0. Source, release artifacts
  and real external integration remain separate evidence.

## 0.1.3 - 2026-10-09

- Optional `require_all_targets` adds opt-in coverage of declared CSV
  targets, detecting expected records with no delivery/evidence rows. Reports
  contain only target locations; existing capacity and finding limits remain.
  This release candidate is not yet published to npm.
- Source artifact contracts support bounded CSV `reference_exists` checks with
  exact string IDs and declared unique target keys. An offline citation example
  rejects dangling references without exposing values; the aggregate index is
  capped at 100,000 referenced cells, including repeats.
- Source string artifact fields support bounded exact `one_of` options for
  classification labels, with a physical CSV/JSON material-intake example.
  Unknown labels fail without value disclosure; classifications do not prove approval.
- Source `https_url` artifact fields validate bounded HTTPS addresses
  against exact declared DNS hosts, with an offline knowledge-source inventory.
  The checker never fetches sources, retains URL values in reports or proves truth.
- Candidate `artifacts` command validates actual local files with strict capacity,
  CSV/JSON contracts, digest binding and cross-file summaries. Reports omit values
  and local paths. Shared scans use bounded reads, metadata allowlists, streamed
  enumeration, no-follow file opens and snapshot-change checks.
- `report` now requires matching plan digests when both an ActionPlan and an
  ApplyReceipt are supplied. Mismatched evidence fails before rendering any
  Markdown, JSON, or SARIF output, with an error that does not expose local
  paths or input digests. Standalone reports and optional evidence remain supported.

## 0.1.2 - 2026-08-31

- Aligned publish contract: unified `package.json`/`docs`/`templates` to `0.1.2`, added OIDC provenance + SBOM (`npm sbom` cyclonedx + `actions/attest-build-provenance`) to `release.yml` and `skillsync.yml`, clarified `README` install channels (`npx 0.1.0` stable vs `0.1.2` from source), and cleaned stale `npm-*` worktrees.
- Added extensible profile registry: `src/profiles/registry.ts` discovers `profiles/contrib/*.yaml` → `~/.config/skillsync/profiles/` → `--profile-dir`, `profile validate`/`list` CLI, `compat`/`verify` now accept `--profile-dir`, and contrib examples `windsurf@1`/`opencode@1` with `docs/compatibility.md` registry documentation.

## 0.1.1 - 2026-08-08

- Corrected the valid Docker workspace bind-mount form and recorded controlled smoke evidence.
- Hardened immutable reference-image inputs and instruction-network isolation while retaining
  fail-closed local validation.
- Recorded current local release evidence: 436 passed tests across 69 files, one opt-in Docker
  integration skip locally, and type-check, lint, build, and package dry-run completion.

## 0.1.0 - 2026-08-04

- Added read-only `scan`, `compat`, `verify`, semantic `diff`, `lock`, adopt-plan, and fixture-only `test` CLI commands.
- Added deterministic Skill digests, frontmatter and structure findings.
- Added versioned Codex, Claude Code, and Cursor capability profiles.
- Added provenance evidence, lock generation/checking, semantic diff, policy evaluation, and SARIF output.
- Added CI/pre-commit template generation with explicit apply/force guards.
- Added explicit adopt lock-snapshot apply with confirmation, conflict protection, and backups.
- Added strict `behavior.yaml` fixture preflight with required/forbidden path checks and explicit `execution: not-run` reporting.
- Added strict `behavior.yaml v2` Replay execution with bounded Runner JSONL validation, disposable staging, virtual output invariants, redacted evidence, and fail-closed Docker-unavailable reporting.
- Added the opt-in Docker sandbox backend with local runtime/image checks, digest-pinned no-pull execution, non-root read-only containers, network denial, bounded output, timeout kill, and idempotent teardown.
- Added strict Runner image contract validation, forced `/usr/local/bin/skillsync-runner` entrypoint, and terminal/process exit-code consistency checks.
- Added an inert contract-compatible reference Runner image, opt-in Docker lifecycle smoke fixture/workflow, and `runner validate` for offline Config or local immutable-image checks.
- Added independent staged workspace tree hashing and Runner `fs.write` cross-checks, plus bounded detached provenance policy checks that never contact registries.
- Added offline Provider adapter conformance manifests and `runner adapter validate` with explicit short-lived credential declarations that never carry credential values.
- Added offline egress proxy decision checks and remote lifecycle state/cleanup contracts; neither enables network access or remote execution.
- Hardened adapter validation to require an external immutable image binding, rejected IPs in hostname allowlists/redirects, and bound remote cleanup proofs to run/resource/evidence digests.
- Added external adapter identity policies, expected remote resource/event anchors, terminal cancellation idempotency, and AST-based offline side-effect bypass fixtures.
- Added externally anchored remote retry attempts that require prior cleanup, exact duplicate handling, and expanded AST fixtures for import, DNS, server, worker, and process bypass forms.
- Added a pure runtime capability activation gate requiring independent review, controlled-environment verification, immutable artifacts, and ordered capability activation.
- Added an offline provider credential reference contract that rejects secret values and bounds requests by external reference, scope, TTL, and revocation.
- Added `verify --policy <path>` for explicit YAML/JSON policy loading and exit code `2` for invalid policy configuration.
- Added the product trust loop with stable Issue IDs and lifecycle state, `explain`, safe `fix --plan` and bounded `fix --apply`, `report`, and `baseline` commands; only a fresh re-verify can establish `verified`, and manual resolutions never invent or overwrite user content.
- Added no-execution, symlink-boundary, fixture, and dogfood regression tests.
