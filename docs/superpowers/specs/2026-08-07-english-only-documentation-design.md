# English-Only Documentation Migration Design

**Date:** 2026-08-07
**Status:** Draft for review
**Scope:** Repository documentation, metadata descriptions, links, and documentation tests

## Decision

SkillSync will use English as the only language for tracked repository documentation and user-visible descriptions. The migration will preserve technical meaning, command names, schema keys, error codes, security boundaries, historical dates, and evidence claims. It will not change product behavior or enable any runtime capability.

The repository will have English canonical filenames for design documents. Existing internal links, package metadata, documentation tests, release notes, and public navigation will be updated in the same change set.

## Context

The repository is already suitable for public source publication, and its implementation and CI checks are green. Most governance and technical documents are English, but nine tracked Markdown files still contain Han characters. The largest gaps are the README, three root-level design documents, and Chinese sections in the credential, runner, runtime activation, and release-readiness documents.

The current documentation test also asserts several Chinese phrases. Leaving those assertions in place would make the repository fail its own English-only policy after translation.

## Goals

1. Make every tracked Markdown document readable by an English-speaking maintainer or contributor.
2. Make every user-visible `description` field and documentation-facing description English.
3. Establish consistent document structure without flattening historical design records into generic guides.
4. Keep all commands, paths, schema fields, security claims, and verification evidence accurate.
5. Detect future accidental non-English prose and broken local Markdown links in CI.
6. Produce a release-ready documentation set that can be reviewed and published independently of runtime feature work.

## Non-goals

- No changes to CLI behavior, APIs, schemas, fixture semantics, runtime activation policy, or security controls.
- No translation of provider names, product names, command names, flags, URLs, code, JSON/YAML keys, error codes, or immutable identifiers.
- No npm publication or change from `private: true`.
- No rewriting of historical dates or verification results.
- No introduction of a second documentation website or a new documentation generator.

## Document inventory and canonical names

The following files require substantive translation or normalization:

| Current path | Canonical path | Treatment |
| --- | --- | --- |
| `README.md` | `README.md` | Rewrite as the English public entry point. |
| Legacy Chinese-named MVP plan | `MVP-Implementation-Plan.md` | Translate and rename; update every reference. |
| Legacy Chinese-named complete design record | `SkillSync-Complete-Design.md` | Translate and rename; preserve section numbering and technical vocabulary. |
| Legacy Chinese-named competitive research record | `Competitive-Research-and-Design-Rationale.md` | Translate and rename; preserve research conclusions and decision history. |
| `docs/credential-contract.md` | same path | Translate Chinese passages and standardize headings. |
| `docs/release-readiness-2026-08-05.md` | same path | Translate mixed-language release evidence; preserve date and historical status. |
| `docs/runner-contract.md` | same path | Translate Chinese passages and keep contract terminology exact. |
| `docs/runner-provenance.md` | same path | Translate Chinese passages and keep evidence limitations explicit. |
| `docs/runtime-activation-gate.md` | same path | Translate Chinese passages without weakening fail-closed requirements. |

All other tracked Markdown files will receive an English-language and link audit. Existing English content will be changed only where needed for consistency, accuracy, or a standard document introduction.

Chinese filenames will not remain as compatibility copies in the canonical tree. The migration will record the old-to-new path mapping in `CHANGELOG.md` so external readers can locate the replacement documents. Git history remains the source of truth for the original paths.

## Documentation standards

### Language and terminology

- Use clear international English with short sentences and active voice.
- Use one term consistently for each concept: `Skill`, `Runner`, `Provider adapter`, `Worker`, `credential reference`, `offline simulation`, and `live capability`.
- Use ISO dates in new prose: `YYYY-MM-DD`.
- Keep normative words precise: `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are reserved for contractual requirements.
- Keep code identifiers in their original spelling and casing.

### Structure by document type

- Public entry documents begin with a concise product statement, a purpose-oriented overview, and a stable documentation index.
- Technical contracts begin with `Purpose`, `Scope`, `Contract`, `Failure behavior`, `Security boundary`, and `Verification` where those sections apply.
- Design and research records retain their date, decision history, alternatives, and rejected options. They receive an English summary but are not rewritten as implementation guides.
- Release-readiness and dogfood records retain historical evidence and clearly label current status, unavailable capabilities, and offline-only evidence.
- Fixture and runner reference documents remain focused on reproducibility. Human-readable descriptions must be English; machine-readable payloads remain semantically unchanged.

### Links and examples

- Use repository-relative links for local Markdown files.
- Use descriptive link text rather than raw paths where practical.
- Annotate fenced code blocks with the correct language.
- Examples must not contain real credentials, machine-specific absolute paths, or claims of live evidence when the evidence is simulated.
- Any renamed path must be updated in Markdown, tests, package metadata, templates, workflows, and release notes.

## Description and metadata audit

The implementation pass will inspect and normalize English text in:

- `package.json` name, description, repository, homepage, and bugs metadata;
- Skill frontmatter descriptions under `fixtures/` and any future public Skill examples;
- JSON/YAML schema descriptions and example metadata;
- GitHub issue and pull-request templates;
- workflow names, job descriptions, comments, and release template text;
- CLI-facing documentation descriptions and test fixture labels.

The audit will not alter identifiers or machine-consumed values merely to improve prose. Any description used as a test fixture input will be changed only with its corresponding expectation.

## Test and verification design

The documentation test suite will be updated to:

1. Replace Chinese phrase assertions with their English equivalents.
2. Assert that all canonical documentation links resolve to tracked files.
3. Scan tracked Markdown files for Han characters and fail with the offending paths and line numbers.
4. Check that renamed design documents are referenced by their canonical paths.
5. Preserve existing assertions for security boundaries, runtime gates, package metadata, CI templates, and release behavior.

The migration acceptance suite is:

```text
npm run check
git diff --check
npm pack --dry-run
JSON/YAML/workflow/template parsing
tracked-Markdown English scan
local-Markdown-link scan
public-tree hygiene scan
```

No acceptance result may claim live network, credential, Docker, microVM, or remote Worker evidence unless that evidence is actually produced by an explicitly authorized environment.

## Execution milestones

| Milestone | Target | Deliverable | Dependency |
| --- | --- | --- | --- |
| M0: design approval | T+0 | Approved design and frozen translation rules | User review of this document |
| M1: path and index migration | T+45 min | English canonical filenames, updated README index, changelog mapping, no broken references | M0 |
| M2: content translation | T+3 h | README, design records, contracts, and release records translated and structurally normalized | M1 |
| M3: description audit | T+4 h | English metadata, frontmatter, template, workflow, and fixture descriptions | M2 |
| M4: verification hardening | T+5 h | Documentation tests, English scan, link scan, and full repository checks passing | M2 and M3 |
| M5: publication handoff | T+5.5 h | Reviewed commit, release note, GitHub tree synchronized, and final verification report | M4 and explicit publication confirmation |

The estimates are working-session targets rather than claims about elapsed wall-clock time. A failed check pauses the next milestone until its root cause is understood and corrected.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Renamed files break external bookmarks | Readers may receive 404 responses | Record the mapping in `CHANGELOG.md`, use clear replacement links, and mention the rename in the release handoff. |
| Translation changes a security claim | The public contract could become weaker or misleading | Preserve normative language, compare translated sections against the original, and require a security-boundary review before publication. |
| Fixed-string documentation tests become stale | CI fails or silently loses coverage | Update expectations in the same patch and retain assertions for every critical boundary. |
| Non-English text remains in an overlooked Markdown file | The repository violates the frozen scope | Enforce a tracked-Markdown scan in tests and run it against the final tree. |
| Code examples are translated incorrectly | Users copy invalid commands or configuration | Leave identifiers and executable examples unchanged; translate only surrounding explanation. |
| Historical evidence is presented as current behavior | Users overestimate runtime support | Retain dates, status labels, offline/live distinctions, and fail-closed warnings. |

## Review checklist

Before implementation is considered complete:

- Every tracked Markdown file is English-only.
- No Chinese filename remains in the canonical tree.
- All local links resolve.
- README navigation covers product, usage, architecture, security, contribution, and release information.
- All descriptions visible to users are English.
- Security and runtime documentation still state that unavailable capabilities remain disabled.
- Existing tests pass without weakening assertions.
- The package remains private and no credentials or machine-specific paths are introduced.
- The final diff is limited to documentation, metadata descriptions, links, tests, and release notes.
