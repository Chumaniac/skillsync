# SkillSync project status and optimization review

Status: reviewed source and follow-up plan. Date: 2026-11-02, Asia/Shanghai.

Reviewed baseline: `24bde228cb76441342addaabbc5cd8a377f14bb3`.
The implementation references below apply to that baseline. This change adds a
review document; the proposed implementation changes remain follow-up work.

## Current stage

SkillSync provides an offline Alpha workflow for declared provenance,
compatibility, behavior checks, and physical artifact review. It does not
authenticate a remote publisher, certify execution isolation, or establish
business acceptance.

## Implemented capabilities

- The CLI covers inventory, verify, compat, diff, fix, report, lock, and behavior
  checks. Stable content hashing and path constraints are implemented in
  [the CLI entry point](../../src/cli/index.ts) and
  [digest handling](../../src/domain/digest.ts#L18).
- Artifact contracts, manifests, receipts, physical files, reports, and batch
  review packages are connected. The implementation includes digest binding,
  references, keyed reconciliation, and capacity limits. See
  [artifact commands](../../src/cli/commands/artifacts.ts#L81) and
  [batch reports](../../src/domain/batch-report.ts#L57).
- The loopback Workbench supports package switching, explicit review,
  cancellation, history, and batch review. It uses native HTML and JavaScript;
  see [the server](../../src/workbench/server.ts#L31) and
  [the page](../../src/workbench/page.ts#L15).

## Completion boundaries

- The Git provenance branch checks that a URL and a plausible resolved commit
  are present. It emits `provenance.verified` without checking that the named
  commit contains the current files. See
  [the provenance scanner](../../src/scanners/provenance.ts#L92).
- Artifact review explicitly retains `provenance: not-authenticated`. Signed
  issuers, live providers, remote workers, and production isolation require
  separate design and acceptance. See
  [the security boundary](../../docs/security-boundary.md#L58) and
  [artifact delivery](../../docs/artifact-delivery.md#L18).
- `reference_exists` currently supports a unique string key in CSV. JSON
  relationships and composite references are outside that contract. See
  [the artifact contract](../../src/domain/artifact-contract.ts#L115).

## Prioritized follow-up

P1 identifies a correctness or delivery boundary to resolve first. P2 covers
reliability and maintenance. P3 covers measurements or later extensions.
These priorities are not vulnerability ratings.

### P1 Align provenance labels with the evidence actually checked

Evidence: direct source inspection; no exploit or runtime reproduction was run.
A URL and syntactically valid commit can produce a `verified` finding without
proving a remote-content identity.

Acceptance: use a declared-source/local-comparison status, or introduce an
explicitly controlled Git-object or signature verifier. Cover a present source
declaration whose content does not match the named commit. Keep offline and
authenticated evidence distinct.

References: [scanner](../../src/scanners/provenance.ts#L92),
[documented boundary](../../docs/security-boundary.md#L14).

### P1 Enforce consistent artifact report states

Evidence: a schema constraint is absent in the reviewed source; a constructed
payload has not been executed in this review. `reportSchema` does not explicitly
reject `status: passed` together with `receipt_binding: failed`.

Acceptance: enforce the state implication, cover passed/failed reports against
all receipt states, and keep downstream comparisons closed to incomplete
evidence. See [report parsing](../../src/domain/artifact-report.ts#L58).

### P2 Bind batch declarations to the canonical contract

Checking a contract digest alone does not establish that the report's
declarations match that contract's field mappings and limits.

Acceptance: require canonical declaration equality for successful packages.
Cover absent or altered declarations in both delivery modes. See
[batch report checks](../../src/domain/batch-report.ts#L60) and
[batch commands](../../src/cli/commands/batch.ts#L98).

### P3 Measure repeated scans before adding bounded reuse

Evidence: source-based performance hypothesis; no timing or RSS baseline was
collected. Workbench checks and batch retries can repeat scanning and hashing.

Acceptance: measure representative and near-limit inputs first. Reuse one
operation's immutable snapshot or a bounded cache with strict identity-based
invalidation; preserve change detection and fail-closed behavior. See
[Workbench scans](../../src/workbench/server.ts#L177) and
[batch retries](../../src/cli/commands/batch.ts#L109).

## Verification record

- The reviewed baseline had successful `verify` and `regression` GitHub checks:
  [baseline workflow](https://github.com/Chumaniac/skillsync/actions/runs/41275822538/job/124757678044).
- The initial review commit triggered the repository's existing English-only
  Markdown check. This revision corrects the document language without changing
  the check, its assertions, or implementation code.
- The implementation concerns above are source findings, not completed fixes.
  No live provider, remote runner, Docker canary, or new identity trust root was
  enabled.
