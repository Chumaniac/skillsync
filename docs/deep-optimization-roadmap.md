# SkillSync expansion and deep optimization roadmap

Date: 2026-10-09. Status: active source implementation plan. Baseline:
`a8d2b951d9affbd32f52354f67273fd43dbbbd24`.

## Product position and evidence

SkillSync independently checks Skills and their physical delivery files. Its
value is repeatable, bounded evidence about provenance declarations,
compatibility, content changes, file integrity and explicit data relationships.
It must preserve the distinction between a physical check and authenticated or
executed evidence. SkillTape is a producer; SkillSync does not run that producer.

Public npm remains 0.1.0. GitHub v0.1.4 contains the existing artifact, source,
reference and coverage checks. New rules in this plan are source candidates
until a new public package is separately verified. Live providers, credentials,
remote workers and network egress remain inactive.

## Current distribution and gaps

| Area | Existing owner | Improvement |
| --- | --- | --- |
| Skill inventory and trust loop | verify, scan, diff, fix and report commands | Keep before/after evidence and plan/receipt identity understandable. |
| Physical artifacts | artifact contract, workspace scan and content inspectors | Preserve exact file allowlists, sizes, digests and snapshot stability. |
| Data relations | reference and summary checks | Add per-key integer reconciliation; a grand total can hide wrong allocation. |
| Runtime contracts | runner/provider/egress/activation modules | Keep preflight separate from actual runtime evidence. |
| Public output | text, JSON and SARIF reporters | Bounded diagnostics without IDs, contents, prompts or local paths. |
| Distribution | npm templates and GitHub release workflow | Show the exact source/GitHub/npm capability matrix. |

## This optimization cycle: per-key integer reconciliation

Add an explicit `keyed_integer_sum_equals` check between declared CSV files.
Each side names a required nonempty string key and a required integer column.
Aggregate repeated records by the exact key and compare both key sets and each
key's integer total. This supports one-to-many deliveries and adjustments;
it does not silently coerce IDs, round numbers, trim strings or execute rules.

The canonical negative example keeps IDs and grand totals correct while shifting
an amount between two orders. Existing file, scalar, reference and summary
checks remain necessary. The new rule must find that allocation error without
revealing the record identifiers or values. Optional summaries expose only
declared file/column metadata and counts of missing, extra or mismatched keys.

Reuse the existing streaming CSV parse and stable workspace scan. Retain only
bounded key fingerprints and integer totals, release them after comparison,
and fail closed on per-key overflow or exhaustion. Cap observed reconciliation
cells at 100,000 across the invocation, with no unlimited per-check cache.
Keep the existing 10,000-file/16 MiB-file/64 MiB-total and 256-finding ceilings.

## Domain expansion

| Domain | Contract example | Benefit | Evidence limit |
| --- | --- | --- | --- |
| Code review | Expected versus delivered findings/counts per changed file | Detect lost or misassigned review materials | No semantic correctness or reviewer authentication. |
| Knowledge management | Expected versus retained citation counts per source | Detect per-source omissions despite equal global totals | No fetching, freshness or truth claims. |
| Data operations | Expected versus allocated minor units per order | Find balanced-but-misallocated outputs and partial deliveries | Integer data checks, not financial or identity approval. |
| Operational reporting | Planned versus completed units per incident/task | Reproducible evidence of explicit allocation requirements | No privileged runtime collection. |

## Priority and acceptance matrix

| Priority | Workstream | Acceptance | Dependency |
| --- | --- | --- | --- |
| P0, this cycle | Typed reconciliation declaration | Reject undeclared files, wrong types and ambiguous rules before data inspection | Existing Zod contract. |
| P1, this cycle | Per-key equality and coverage | Match split rows; reject balanced shifts, missing/extra keys, exact-spelling drift and overflow | Existing content observer and bounded index. |
| P1, this cycle | CLI, fixture, report and docs | Real local CSV/JSON tests, bounded private-value-free output, packaged source journey | Existing build and packaging. |
| P2 | Composite keys and structured JSON relations | Explicit canonical key definitions and capacity budgets; no arbitrary expression language | Real adoption cases. |
| P2 | Reviewed baseline pins and policy explanations | Separate caller expectations, observed physical results and unknown evidence | Stable reports and trust-loop contracts. |
| P3 | Authenticated provider/source evidence | Bind reviewed contract, Skill, run and artifact identity to trusted evidence | Key management, runtime and separate authorization. |

## Safety, architecture and performance

Keep content parsing, relation indexing, filesystem observation and reporting
separate. Share CSV parsing rather than parsing the same bytes in a new command.
Declared metadata may be reported; raw cell values and key fingerprints stay
internal. Invalid artifacts and capacity exhaustion cannot become successful
reconciliation evidence. Original contract/report behavior remains unchanged
when the new rule is absent.

Measure fixed small and near-limit synthetic inputs. Record elapsed time and
memory only when measured; document the linear row/group processing and finite
cache as source properties. Avoid live DNS/HTTP, credential injection or a
Provider reference adapter becoming an automatic activation path.

## Quality, distribution and governance

Use positive, negative and boundary fixtures first, then the full test, type,
lint, build and pack allowlist checks. Inspect packaged fixtures and execute the
installed source CLI on synthetic files. Use normal regression/verify main
gates, never disable them. Maintain README, CHANGELOG and artifact documentation
with a source-only notice for unreleased additions.

A future distribution requires its own tag/source binding, package checksums,
validated SBOM, GitHub provenance and independent install journey. Preserve
old npm and GitHub releases. Runtime/Provider/source authentication and real
user acceptance need their own named evidence. Roll back using normal commits.

## Adoption and success measures

Measure useful failure detection, understandable unknown/fail outcomes,
reproducible producer-consumer journeys, bounded large inputs and time to review
a changed contract. Add adapters after a real workflow proves value. Keep
commercial/runtime integration plans distinct from available offline checks.
