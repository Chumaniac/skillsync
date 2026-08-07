# English-Only Documentation Migration Implementation Plan

> **Status:** Complete. The migration was verified locally and delivered to the public `main` branch through GitHub PR #1 on 2026-08-07.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate all tracked repository documentation and user-visible descriptions into English, rename the three non-English canonical documents, repair every reference, and add automated documentation-language and link checks.

**Architecture:** Keep documentation organized by its current role: README and governance as public entry points, `docs/` as technical contracts and operational records, root design documents as product and research records, and fixtures as reproducible examples. Apply translation and path changes without changing executable code, machine-readable identifiers, security boundaries, or runtime activation behavior.

**Tech Stack:** Markdown, Git, Node.js 20+, TypeScript, Vitest, npm scripts, JSON/YAML workflow and template files.

## Global Constraints

- Use English as the only language for tracked repository documentation and user-visible descriptions.
- Preserve technical meaning, command names, schema keys, error codes, security boundaries, historical dates, and evidence claims.
- Do not change CLI behavior, APIs, schemas, fixture semantics, runtime activation policy, or security controls.
- Do not translate provider names, product names, command names, flags, URLs, code, JSON/YAML keys, error codes, or immutable identifiers.
- Keep the package `private: true`; do not publish to npm.
- Use ISO dates in new prose: `YYYY-MM-DD`.
- Do not introduce real credentials, machine-specific absolute paths, or live-evidence claims into documentation.
- Every content-changing task ends with its own focused verification and a commit; verification-only tasks do not create empty commits.

---

## File Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Public entry | `README.md`, `CHANGELOG.md` | English product positioning, navigation, status, and migration notes. |
| Root design records | `MVP-Implementation-Plan.md`, `SkillSync-Complete-Design.md`, `Competitive-Research-and-Design-Rationale.md` | English product, research, and implementation records using canonical filenames. |
| Technical contracts | `docs/credential-contract.md`, `docs/runner-contract.md`, `docs/runner-provenance.md`, `docs/runtime-activation-gate.md` | English contract language with unchanged field names and fail-closed requirements. |
| Release evidence | `docs/release-readiness-2026-08-05.md` | English historical release-readiness record with explicit offline/live boundaries. |
| Repository automation | `.github/workflows/skillsync.yml` | Canonical documentation paths in workflow change filters. |
| Documentation tests | `tests/docs/documentation.test.ts`, `tests/docs/english-documentation.test.ts` | Existing semantic assertions plus English-only and local-link invariants. |
| Implementation record | `docs/superpowers/plans/2026-08-07-english-only-documentation-migration.md` | This plan and task checkboxes. |

## Task 1: Establish the baseline and migrate canonical filenames

**Files:**
- Rename: the three legacy non-English root Markdown paths to `MVP-Implementation-Plan.md`, `SkillSync-Complete-Design.md`, and `Competitive-Research-and-Design-Rationale.md`.
- Modify: `README.md`, `CHANGELOG.md`, `.github/workflows/skillsync.yml`, and every Markdown/test reference to the renamed paths.
- Test: repository path and reference scans.

**Interfaces:**
- Consumes: the current root Markdown files and all repository references found by `rg`.
- Produces: three stable English paths that later translation tasks can edit without another rename.

- [x] **Step 1: Capture the clean baseline.**

  Run:

  ```bash
  git status --short --branch
  legacy_terms=$(printf '%b|%b|%b' '\u5b8c\u6574' '\u5b9e\u65bd' '\u7ade\u54c1')
  rg -n --hidden -g '!node_modules' -g '!dist' \
    -e 'MVP-|SkillSync-|competitive' -e "$legacy_terms" .
  ```

  Expected: branch `docs/english-documentation`, no unrelated worktree changes, and a complete list of references before any path changes.

- [x] **Step 2: Rename the three legacy paths without changing their content.**

  Run in zsh or Bash:

  ```bash
  legacy_mvp=$'MVP-\u5b9e\u65bd\u8ba1\u5212.md'
  legacy_design=$'SkillSync-\u5b8c\u6574\u8bbe\u8ba1\u6587\u6863.md'
  legacy_research=$'\u7ade\u54c1\u7814\u7a76\u4e0e\u8bbe\u8ba1\u63a8\u6f14.md'
  git mv "$legacy_mvp" MVP-Implementation-Plan.md
  git mv "$legacy_design" SkillSync-Complete-Design.md
  git mv "$legacy_research" Competitive-Research-and-Design-Rationale.md
  ```

  Expected: Git reports three renames and no content is altered by this step.

- [x] **Step 3: Update all path references.**

  Replace each legacy path reference with its canonical English path in `README.md`, `CHANGELOG.md`, `.github/workflows/skillsync.yml`, the renamed implementation plan, the release-readiness record, and any tests or templates returned by the baseline scan. Do not translate prose in this step.

- [x] **Step 4: Verify the path migration.**

  Run:

  ```bash
  rg -n --hidden -g '!node_modules' -g '!dist' \
    -e 'MVP-|SkillSync-|complete-design|implementation-plan|competitive-research' .
  git diff --name-status -- README.md CHANGELOG.md .github/workflows/skillsync.yml \
    MVP-Implementation-Plan.md SkillSync-Complete-Design.md \
    Competitive-Research-and-Design-Rationale.md
  ```

  Expected: all navigational references use canonical English paths; the renamed files exist; no workflow path filter points at a removed path.

- [x] **Step 5: Commit the path-only migration.**

  ```bash
  git add README.md CHANGELOG.md .github/workflows/skillsync.yml \
    MVP-Implementation-Plan.md SkillSync-Complete-Design.md \
    Competitive-Research-and-Design-Rationale.md
  git commit -m "docs: adopt English canonical document paths"
  ```

## Task 2: Rewrite the README as the English public entry point

**Files:**
- Modify: `README.md`.
- Test: `tests/docs/documentation.test.ts` after the content assertions are updated in Task 7.

**Interfaces:**
- Consumes: current product positioning, CLI examples, release-candidate evidence, and security boundary text.
- Produces: the canonical public navigation and the only document a new visitor must read first.

- [x] **Step 1: Replace the title and opening statement.**

  Use the title `# SkillSync: Provenance, Compatibility, and Behavior Verification for Agent Skills` and state that SkillSync validates installed Agent Skills, their source, compatibility, and behavior. Keep the comparison with installation and synchronization tools, but express it in English.

- [x] **Step 2: Rebuild the documentation index.**

  Use links to `SkillSync-Complete-Design.md`, `Competitive-Research-and-Design-Rationale.md`, `MVP-Implementation-Plan.md`, and `docs/release-readiness-2026-08-05.md`. Keep the existing technical document links for runtime activation and operator guidance, using descriptive English link text.

- [x] **Step 3: Translate status and trust-boundary sections without changing claims.**

  Preserve the current command list (`scan`, `compat`, `verify`, semantic `diff`, `lock`, `adopt`, fixture-only `test`, `ci init`, `runner validate`, and `runner adapter validate`), the default no-script-execution boundary, the offline Replay/Docker distinction, the inert reference Runner limitation, and the disabled live-runtime order.

- [x] **Step 4: Translate the release validation, package boundary, privacy boundary, quick start, and 15-minute trust loop.**

  Keep the exact validation count and date currently recorded, the `private: true` npm boundary, `<local-path>`, `include_local_paths`, and all executable commands unchanged except for surrounding prose and canonical documentation paths.

- [x] **Step 5: Verify the public entry point.**

  Run:

  ```bash
  if rg -n -P '\\p{Han}' README.md; then exit 1; else echo 'README is English-only'; fi
  rg -n 'SkillSync-Complete-Design|Competitive-Research-and-Design-Rationale|MVP-Implementation-Plan' README.md
  ```

  Expected: no Han characters, all four canonical documentation links present, and no machine-specific path or credential value introduced.

- [x] **Step 6: Commit the README migration.**

  ```bash
  git add README.md
  git commit -m "docs: make README the English public entry point"
  ```

## Task 3: Translate the complete design record

**Files:**
- Modify: `SkillSync-Complete-Design.md`.
- Test: full-file English scan and link scan.

**Interfaces:**
- Consumes: the existing 0-16 section structure, product positioning, CLI surface, Verification Contract, profiles, lock/policy model, architecture, MVP, roadmap, and Definition of Done.
- Produces: an English technical baseline referenced by the README and implementation plan.

- [x] **Step 1: Preserve the document outline before translating prose.**

  Record the current heading sequence with:

  ```bash
  rg -n '^#{1,6} ' SkillSync-Complete-Design.md > /tmp/skillsync-design-headings.before
  wc -l < /tmp/skillsync-design-headings.before > /tmp/skillsync-design-heading-count.before
  ```

  Do not change section numbers, CLI identifiers, schema names, or code blocks while translating the surrounding prose.

- [x] **Step 2: Translate the product, problem, goals, non-goals, and competitive-positioning sections.**

  Use the approved English positioning: SkillSync is a verification layer, not another synchronization manager. Preserve all alternatives, rejected directions, and explicit scope boundaries. Add a concise `Summary` paragraph below the title when the current record does not already have one.

- [x] **Step 3: Translate the CLI, Verification Contract, capability profile, manifest, lockfile, policy, security, architecture, MVP, roadmap, and Definition of Done sections.**

  Keep commands, flags, YAML/JSON snippets, rule codes, and field names byte-for-byte unless a path now points to a canonical English document.

- [x] **Step 4: Compare the translated outline and scan the result.**

  Run:

  ```bash
  rg -n '^#{1,6} ' SkillSync-Complete-Design.md > /tmp/skillsync-design-headings.after
  wc -l < /tmp/skillsync-design-headings.after > /tmp/skillsync-design-heading-count.after
  test "$(cat /tmp/skillsync-design-heading-count.before)" = "$(cat /tmp/skillsync-design-heading-count.after)"
  if rg -n -P '\\p{Han}' SkillSync-Complete-Design.md; then exit 1; else echo 'Design record is English-only'; fi
  ```

  Expected: the heading count is unchanged, headings are readable English, and the file contains no Han characters.

- [x] **Step 5: Commit the complete design translation.**

  ```bash
  git add SkillSync-Complete-Design.md
  git commit -m "docs: translate complete design record"
  ```

## Task 4: Translate the implementation plan and competitive research record

**Files:**
- Modify: `MVP-Implementation-Plan.md`, `Competitive-Research-and-Design-Rationale.md`.
- Test: heading preservation, English-only scan, and canonical-path scan.

**Interfaces:**
- Consumes: the existing implementation task IDs, test-first sequence, competitor findings, product alternatives, and decision rationale.
- Produces: English records that remain traceable to the implementation history and the approved product direction.

- [x] **Step 1: Capture both original heading sequences and task/checklist counts.**

  ```bash
  rg -n '^#{1,6} ' MVP-Implementation-Plan.md > /tmp/skillsync-mvp-headings.before
  rg -n '^#{1,6} ' Competitive-Research-and-Design-Rationale.md > /tmp/skillsync-research-headings.before
  wc -l < /tmp/skillsync-mvp-headings.before > /tmp/skillsync-mvp-heading-count.before
  wc -l < /tmp/skillsync-research-headings.before > /tmp/skillsync-research-heading-count.before
  rg -n '^[-*] \[[ xX]\]' MVP-Implementation-Plan.md | wc -l > /tmp/skillsync-mvp-checklist-count.before
  ```

  Expected: the plan retains its task structure and checklist coverage after translation.

- [x] **Step 2: Translate the implementation plan.**

  Keep task IDs, file paths, module names, test commands, acceptance gates, and checked-state markers unchanged. Translate task descriptions, rationale, and explanatory notes into concise English. Add an English `Summary` and `Status` line below the title without changing task ordering.

- [x] **Step 3: Translate the competitive research and design rationale.**

  Preserve source links, product names, research dates, conclusions, rejected options, and open assumptions. Translate only the explanatory prose and headings, and add an English `Summary` and `Status` line below the title.

- [x] **Step 4: Verify structure, links, and language.**

  ```bash
  rg -n '^#{1,6} ' MVP-Implementation-Plan.md > /tmp/skillsync-mvp-headings.after
  rg -n '^#{1,6} ' Competitive-Research-and-Design-Rationale.md > /tmp/skillsync-research-headings.after
  wc -l < /tmp/skillsync-mvp-headings.after > /tmp/skillsync-mvp-heading-count.after
  wc -l < /tmp/skillsync-research-headings.after > /tmp/skillsync-research-heading-count.after
  rg -n '^[-*] \[[ xX]\]' MVP-Implementation-Plan.md | wc -l > /tmp/skillsync-mvp-checklist-count.after
  test "$(cat /tmp/skillsync-mvp-heading-count.before)" = "$(cat /tmp/skillsync-mvp-heading-count.after)"
  test "$(cat /tmp/skillsync-research-heading-count.before)" = "$(cat /tmp/skillsync-research-heading-count.after)"
  test "$(cat /tmp/skillsync-mvp-checklist-count.before)" = "$(cat /tmp/skillsync-mvp-checklist-count.after)"
  if rg -n -P '\\p{Han}' MVP-Implementation-Plan.md Competitive-Research-and-Design-Rationale.md; then exit 1; else echo 'Root records are English-only'; fi
  ```

  Expected: heading and checklist counts are unchanged, no Han characters remain, and all local links use canonical paths.

- [x] **Step 5: Commit the two record translations.**

  ```bash
  git add MVP-Implementation-Plan.md Competitive-Research-and-Design-Rationale.md
  git commit -m "docs: translate implementation and research records"
  ```

## Task 5: Translate contracts and historical release evidence

**Files:**
- Modify: `docs/credential-contract.md`, `docs/runner-contract.md`, `docs/runner-provenance.md`, `docs/runtime-activation-gate.md`, `docs/release-readiness-2026-08-05.md`.
- Test: `tests/docs/documentation.test.ts` assertions and full-file English scan.

**Interfaces:**
- Consumes: current offline contracts, failure behavior, provenance limitations, activation ordering, and release evidence.
- Produces: English operational documentation that retains fail-closed semantics and historical evidence labels.

- [x] **Step 1: Translate the credential and Runner contracts.**

  Preserve `secret://`, scope, TTL, revocation, `runner validate`, immutable image references, provenance rule codes, and the statement that the contract does not read or inject real credentials. Where absent, add the standard headings `Purpose`, `Scope`, `Contract`, `Failure behavior`, `Security boundary`, and `Verification` around existing content without deleting requirements.

- [x] **Step 2: Translate the activation gate.**

  Preserve the activation order `egress → provider-credentials → docker-microvm → remote-worker`, `enable_live_capabilities: false`, `authoritative: false`, no-socket behavior, and all runtime deployment schema names.

- [x] **Step 3: Translate the release-readiness record.**

  Preserve the date, local release candidate status, independent security review result, Docker unavailability, offline simulator evidence, and the distinction between prepared contracts and disabled live capabilities.

- [x] **Step 4: Update exact documentation-test expectations.**

  Replace the existing non-English assertions with these English assertions while retaining the surrounding coverage:

  ```ts
  expect(readiness).toContain("Local release candidate status");
  expect(readiness).toContain("independent security review");
  expect(readiness).toContain("Docker daemon remains unavailable");
  expect(activationGate).toContain("does not open sockets");
  expect(credentialContract).toContain("does not parse the host environment");
  ```

- [x] **Step 5: Verify the contract translation.**

  ```bash
  if rg -n -P '\\p{Han}' docs/credential-contract.md docs/runner-contract.md \
    docs/runner-provenance.md docs/runtime-activation-gate.md \
    docs/release-readiness-2026-08-05.md; then exit 1; else echo 'Contracts are English-only'; fi
  npm test -- tests/docs/documentation.test.ts
  ```

  Expected: the focused test passes and no security or runtime boundary assertion is removed.

- [x] **Step 6: Commit the contract and release translation.**

  ```bash
  git add docs/credential-contract.md docs/runner-contract.md \
    docs/runner-provenance.md docs/runtime-activation-gate.md \
    docs/release-readiness-2026-08-05.md tests/docs/documentation.test.ts
  git commit -m "docs: translate runtime contracts and release evidence"
  ```

## Task 6: Audit user-visible descriptions and repository metadata

**Files:**
- Modify only files containing non-English human-readable descriptions, including any affected `fixtures/**/SKILL.md`, JSON/YAML metadata, GitHub templates, workflow prose, and `package.json` if its description requires correction.
- Test: repository-wide description scan and existing documentation test.

**Interfaces:**
- Consumes: all tracked `description`, `title`, `name`, `summary`, and human-readable fixture fields.
- Produces: English user-visible metadata without changing machine identifiers or fixture behavior.

- [x] **Step 1: Inventory description fields.**

  ```bash
  rg -n --hidden -g '!node_modules' -g '!dist' \
    -i '(^|[[:space:]])(description|summary|title|name):|"(description|summary|title|name)"[[:space:]]*:' .
  ```

  Expected: a reviewable list of metadata fields, with source formats separated from executable code.

- [x] **Step 2: Translate only human-readable descriptions.**

  Keep package name/version, command identifiers, schema keys, fixture directory names, rule codes, and workflow trigger values unchanged. The current package description is already English; retain it unless the audit identifies a concrete consistency issue.

- [x] **Step 3: Verify metadata syntax and language.**

  ```bash
  if rg -n -P '\\p{Han}' --hidden -g '!node_modules' -g '!dist' \
    --glob '*.md' --glob '*.json' --glob '*.yaml' --glob '*.yml'; then
    exit 1
  else
    echo 'Tracked documentation and metadata are English-only'
  fi
  ```

  Expected: no Han characters in documentation or metadata; JSON/YAML remain parseable.

- [x] **Step 4: Commit the description audit.**

  ```bash
  changed_files=$(git diff --name-only --diff-filter=AM -- \
    package.json fixtures .github templates config profiles runner)
  if [ -n "$changed_files" ]; then
    printf '%s\\n' "$changed_files" | xargs git add
    git diff --cached --name-only
    git commit -m "docs: standardize user-facing English descriptions"
  else
    echo 'No description metadata changes were required'
  fi
  ```

## Task 7: Add automated English-only and local-link checks

**Files:**
- Create: `tests/docs/english-documentation.test.ts`.
- Modify: `tests/docs/documentation.test.ts` only for canonical paths and English expectations.
- Test: the new focused test and the complete test suite.

**Interfaces:**
- Consumes: tracked Markdown paths from Git and repository-relative Markdown links.
- Produces: deterministic Vitest failures that identify the file and line containing a language or link violation.

- [x] **Step 1: Add the failing invariant test.**

  Create `tests/docs/english-documentation.test.ts` with this implementation shape:

  ```ts
  import { execFileSync } from "node:child_process";
  import { existsSync } from "node:fs";
  import { readFile } from "node:fs/promises";
  import { dirname, resolve } from "node:path";
  import { describe, expect, it } from "vitest";

  function trackedMarkdownFiles(): string[] {
    return execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
      encoding: "utf8",
    }).split("\\0").filter(Boolean);
  }

  describe("English repository documentation", () => {
    it("contains no Han characters in tracked Markdown", async () => {
      for (const file of trackedMarkdownFiles()) {
        const source = await readFile(file, "utf8");
        const match = /\\p{Script=Han}/u.exec(source);
        if (match) {
          const line = source.slice(0, match.index).split("\\n").length;
          throw new Error(`${file}:${line} contains a non-English character`);
        }
      }
    });

    it("resolves repository-relative Markdown links", async () => {
      for (const file of trackedMarkdownFiles()) {
        const source = await readFile(file, "utf8");
        for (const match of source.matchAll(/\\]\\(([^)\\s]+)(?:\\s+[^)]*)?\\)/g)) {
          const target = match[1].split("#", 1)[0].trim();
          const isExternal = target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:");
          if (!target || isExternal || target.startsWith("#")) continue;
          expect(existsSync(resolve(dirname(file), target)), `${file} -> ${target}`).toBe(true);
        }
      }
    });
  });
  ```

- [x] **Step 2: Run the focused test before the final cleanup.**

  ```bash
  npm test -- tests/docs/english-documentation.test.ts
  ```

  Expected after Tasks 1-6: PASS with no Han-character or broken-link failures. If a failure identifies a real omission, fix the referenced document or link rather than weakening the invariant.

- [x] **Step 3: Run the documentation test group.**

  ```bash
  npm test -- tests/docs
  ```

  Expected: all documentation, metadata, runtime-boundary, and release assertions pass.

- [x] **Step 4: Commit the documentation invariants.**

  ```bash
  git add tests/docs/english-documentation.test.ts tests/docs/documentation.test.ts
  git commit -m "test: enforce English documentation and valid links"
  ```

## Task 8: Update workflow filters and release documentation

**Files:**
- Modify: `.github/workflows/skillsync.yml`, `CHANGELOG.md`, and any remaining file returned by the canonical-path scan.
- Test: workflow YAML parsing and path-reference scan.

**Interfaces:**
- Consumes: canonical root-document paths and the English-only migration record.
- Produces: CI behavior that still runs documentation checks when any canonical design document changes, plus a discoverable release note.

- [x] **Step 1: Replace removed paths in workflow filters.**

  Keep the workflow triggers and jobs unchanged; update only the three path-filter entries to `MVP-Implementation-Plan.md`, `SkillSync-Complete-Design.md`, and `Competitive-Research-and-Design-Rationale.md`.

- [x] **Step 2: Add an English migration note to `CHANGELOG.md`.**

  Add an `Unreleased` documentation entry that identifies the three canonical English replacement paths, notes that historical versions remain available through Git history, and states that all tracked Markdown and user-visible descriptions are now English-only.

- [x] **Step 3: Verify workflow and release references.**

  ```bash
  rg -n --hidden -g '!node_modules' -g '!dist' \
    -e 'MVP-Implementation-Plan|SkillSync-Complete-Design|Competitive-Research-and-Design-Rationale' .
  node --input-type=module -e 'import fs from "node:fs"; import { parse } from "yaml"; parse(fs.readFileSync(".github/workflows/skillsync.yml", "utf8")); console.log("workflow YAML is valid")'
  if rg -n -P '\\p{Han}' CHANGELOG.md .github/workflows/skillsync.yml; then exit 1; else echo 'Release and workflow prose are English-only'; fi
  ```

  Expected: no removed path remains, the workflow still names every canonical design document, and the release note is English-only.

- [x] **Step 4: Commit the automation and release updates.**

  ```bash
  git add .github/workflows/skillsync.yml CHANGELOG.md
  git commit -m "docs: record English documentation migration"
  ```

## Task 9: Run the full release-readiness verification

**Files:**
- Modify: none unless a verification failure identifies a documentation-only defect.
- Test: repository-wide quality, package, syntax, language, link, and public-tree checks.

**Interfaces:**
- Consumes: all commits from Tasks 1-8.
- Produces: fresh evidence for the final review and GitHub publication handoff.

- [x] **Step 1: Run the complete project check.**

  ```bash
  npm run check
  ```

  Expected: tests, type-check, lint, and build all pass.

- [x] **Step 2: Verify package contents and syntax.**

  ```bash
  npm pack --dry-run
  git diff --check
  node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync("package.json","utf8")); console.log("package.json is valid JSON")'
  ```

  Expected: package creation remains dry-run only; no credentials or machine-specific paths appear in the package file list.

- [x] **Step 3: Run the public-tree and documentation gates.**

  ```bash
  npm test -- tests/docs
  if rg -n -P '\\p{Han}' --glob '*.md' .; then exit 1; else echo 'All repository Markdown is English-only'; fi
  git grep -nE '(/Users/[[:alnum:]._-]+/|/home/[[:alnum:]._-]+/|Bearer [A-Za-z0-9._~-]{16,}|api[_-]?key[^[:space:]]{0,20}[=:][[:space:]]*[A-Za-z0-9._~-]{8,}|secret[_-]?key[^[:space:]]{0,20}[=:][[:space:]]*[A-Za-z0-9._~-]{8,})' -- \
    '*.md' '*.json' '*.yaml' '*.yml' && exit 1 || true
  ```

  Expected: documentation tests pass, the language scan has no matches, and the public-tree hygiene scan has no secrets or local absolute paths.

- [x] **Step 4: Review the final diff against the approved scope.**

  ```bash
  git diff --stat 570edb9..HEAD
  git diff --name-only 570edb9..HEAD
  git status --short --branch
  ```

  Expected: changed files are limited to documentation, metadata descriptions, links, tests, workflow filters, release notes, and the approved plan/design records; no source behavior or runtime activation file changes are present.

  Record the fresh `npm run check`, package, language scan, link scan, and public-tree results in the final handoff before synchronizing GitHub. Create a commit only if this verification identifies a documentation-only fix.

## Completion Criteria

- Every tracked Markdown file is English-only.
- No legacy non-English filename remains in the canonical tree.
- All local Markdown links resolve.
- The README links to the canonical design, research, implementation, and release documents.
- All user-visible descriptions are English.
- Runtime and security documentation still state that unavailable capabilities remain disabled and that offline evidence is not live evidence.
- `npm run check`, `npm pack --dry-run`, documentation tests, syntax checks, and public-tree hygiene checks pass.
- The final diff contains no credentials, machine-specific paths, or unrelated source changes.

## Completion Record

- All nine migration tasks and the final review criteria are complete.
- Local validation passed with 69 test files passed and 1 Docker-gated test skipped; 426 tests passed and 1 skipped; type-check, lint, build, package dry-run, documentation tests, language checks, link checks, and public-tree hygiene checks passed.
- Commit `23f653b` was published through PR #1 and merged into the public `main` branch as merge commit `a99503d`.
- Real network access, credentials, Docker/microVM execution, and remote Workers remain intentionally disabled and are outside this documentation migration.
