# Changelog

## Unreleased

- Documented the English-only documentation migration by aligning the public workflow
  filters with `MVP-Implementation-Plan.md`, `SkillSync-Complete-Design.md`, and
  `Competitive-Research-and-Design-Rationale.md`; historical versions remain available
  through Git history, and all tracked Markdown and user-visible descriptions are now
  English-only.
- Prepared the public repository boundary with open-source contribution, security, conduct,
  issue, and pull-request guidance.
- Added canonical GitHub repository, homepage, and issue-tracker metadata, plus cross-platform
  LF normalization for checked-in text files.
- Hardened public CI for web-uploaded fixture modes and runner portability, made SARIF results
  acceptable to Code Scanning, and moved generated GitHub Actions to CodeQL v4.
- Kept live network, provider credentials, microVM, and remote Worker capabilities disabled;
  public verification remains offline and fail-closed.
- Completed the local release-candidate review: `npm test` passed 400 tests across 68 files
  with 1 Docker integration test skipped, and the focused offline runtime-preparation set
  passed 61 tests across 7 files. Type-check, lint, build, package dry-run, workflow/JSON
  parsing, public-tree hygiene, AST side-effect, live-entrypoint, and false-only workflow
  input checks passed locally; no controlled or remote runtime evidence was claimed.

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
