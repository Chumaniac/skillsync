# Workbench history and rechecks

## Choose a task and continue from its result

The single-directory page separates Skill inspection from artifact acceptance.
Each choice explains its directory and contract requirements. Empty inputs are
marked next to the field before a verification request is sent. After a run, a
summary above the sandboxed report explains its outcome and next step. Only a
complete current Skill result with actionable issues offers a plan; artifact
checks direct you to repair the original inputs and verify again.

A historical verification is labelled read-only. Its **Recheck current files**
action returns to the single-directory task and performs a fresh selection and
verification. It never applies the stored plan. Multi-batch reports retain their
separate package summary and do not show a single-directory action summary.

The local graphical workbench keeps immutable index records beside reports,
plans and receipts in its private state directory. Open **History** to inspect a
previous verification and use it as a baseline. Click **Verify directory** to
explicitly select and inspect the current files. The comparison counts new,
ongoing and no-longer-observed issues; it is not execution or safety approval.

Reopening a report or plan never restores an apply capability. Generate a fresh
plan after verifying the current directory, then review and explicitly confirm
the backup and apply action. A recorded apply request without a completed receipt
has an unconfirmed outcome: inspect the directory before taking further action.

Current source builds bind new fix plans to the selected directory's device and
file identity as well as its content. Replacing a directory with an identical
copy invalidates the plan: select the directory again, verify it, then review a
fresh plan. The workbench checks this after planning, and the applying CLI checks
the binding before modifying files. Detected replacement also blocks rollback
into the replacement directory; retained backups remain available for review.
Older saved plans can still be viewed, but cannot regain a workbench apply button.
This detects replacements at the checked boundaries; it is not an operating-system
lock against a process concurrently changing the filesystem.

## Reviewed plans and failed apply recovery

`skillsync report --plan` now recomputes the same canonical ActionPlan digest
used before application. Changing the root path/identity, Issue IDs, patches or
manual steps while retaining an old digest is rejected before any report is
rendered, including when a matching-looking Receipt is supplied. Errors do not
echo the plan contents or root path. Generated time remains outside the existing
digest contract. Legacy plans without a root identity remain readable for offline
reporting; reopening them still cannot restore a workbench apply capability.

An apply failure retains its temporary original-file backups, including when
successful-operation backups were disabled. The CLI now reports that location
in text and JSON. A complete rollback returns the existing `restored` receipt.
If directory replacement or another failure prevents complete rollback, JSON
contains `error.recovery` with `status: rollback-incomplete`, the plan digest,
backup path, changed paths and failed rollback paths. This recovery record is
not an ApplyReceipt and cannot be cited as an applied/restored result. No
automatic retry or restore into a replacement directory occurs. Inspect the
original directory and retained materials before further changes; do not rerun
the mutation just to rediscover a backup path.

The workbench retains its existing unconfirmed-apply intent on a failed child
command; these CLI diagnostics do not turn it into a completed apply or revive
an old plan. Recheck the selected directory separately.

2026-10-29 local checks used synthetic files: 718 distinct checks passed and one
existing check was skipped. The initial restricted-context run passed 700;
18 integration checks requiring loopback access and the built CLI passed after
that prerequisite was supplied. TypeScript, lint and build passed. The actual
CLI completed plan → apply → verify → evidence report (before exit 1, after exit
0), then rejected five altered plans without changing inputs. Controlled
filesystem fault injection covered incomplete and complete rollback with both
backup settings, retained originals and untouched replacement files. No Skill
script, provider, production deployment or installed version was executed.

The list reads only small metadata records and shows twelve entries per page.
Only opening a record reads its bounded, digest-bound body. The original limit
is **120 state files and 64 MiB**, not 120 tasks. A report normally uses two
files, and an apply additionally retains its intent. Capacity is reserved before
commands, especially before mutation. A full directory remains readable and is
never automatically pruned. Start a separate state directory for new work.

Existing older report files remain unchanged; indexed history starts with this
version. Missing or corrupt materials cannot become a successful recheck.
Private bookmarks contain the location necessary to select the same directory;
the downloadable comparison summary omits these locations, report bodies and
backup paths. Checksums detect changed materials, not authenticated authorship.

Tests cover real CLI verification, explicit backup/apply, recheck, process
restart, immutable old records, stale plans, replaced roots, missing and symbolic
link evidence, cross-origin requests, cancellation and a full state directory.

Refresh and newly saved results return to the first history page. Unchanged
refreshes reuse the displayed rows. Section links in an embedded report stay
inside that report. If the local service restarts, reopen the workbench page
to renew its session; saved history remains available. You can enter full
paths directly when the system file picker is unavailable.

## History reads during verification

Start verification while the initial history list or a refresh is loading. Read-only listing does not acquire the operation lock used by verification, planning and apply. If a new result arrives before the old list, the workbench reloads the first page after that read finishes. Cancellation and write exclusion remain in place.

The concurrent service and delayed-list regressions fail before the fix and pass afterward. The local suite passes 679 checks, with one optional Docker check skipped; type checking, lint and build pass. Package and browser acceptance are recorded separately in the delivery receipt.

## Review a fresh plan after an interrupted check

Starting a new verification or plan request revokes the previous plan and its confirmation. If the request fails or is cancelled, the apply control stays unavailable. Complete verification and review a fresh plan before applying changes; retained reports and receipts remain readable.

## Locate affected CSV records

Artifact checks in the workbench retain the same bounded record-position evidence as offline HTML reports. Expand **Locate affected CSV records** to inspect the expected and delivered CSV record positions, then reopen the saved report later without rerunning the check. Positions start at 1, exclude the header and count quoted multiline records as one record; they are not physical text-line numbers.

Only positions and declared column metadata are retained. Record identities and cell values are omitted, and the report names incomplete or truncated evidence. Machine JSON stays unchanged by default; use `--include-row-evidence` when a separate human review needs these bounded positions.


## Apply completion and uncertain batch output

Every confirmed apply attempt consumes the current plan and its actionable issue
authority, including a stale-file failure. The old report remains historical
evidence. A fresh verification is required before another plan can be generated.
The page labels applied-but-not-rechecked and unconfirmed outcomes separately.

If a batch run fails or is cancelled, the page retains the exact attempted output
path and offers an explicit read-only integrity check. This handles cancellation
after the CLI has already published its immutable packet. Missing files produce
an explicit error; the operation is not rerun and no existing packet is replaced.
Opening a packet verifies saved evidence only; it does not recheck current inputs
or authenticate its author.

Editing a directory or contract invalidates the displayed evidence on input,
before blur can collapse the report under a click. Consent stays disabled while
a plan is loading, and clearing an already empty report does not remount its frame.


## Packet paths and independent expected digests

Opening a packet shows its observed SHA-256 in the result, without copying that
value into the optional expected-digest field. That field is reserved for an
independent trusted source. Selecting or editing another packet clears the old
report and success summary immediately, while preserving any manually supplied
expected digest. An incorrect expected digest still rejects the read. Packet
contents are never changed by this UI flow. Cancelled-output recovery remains a
read-only integrity inspection, not authorship or current-input acceptance.


## Find saved history

History can now filter by directory basename (up to 128 characters), task kind
and recorded exit code 0–4. Apply or clear criteria explicitly. Pagination and
refresh keep the last successful criteria; a failed read preserves those criteria,
rows and page. Directory parents, report bodies and backup locations are neither
searched nor included in the list. Entries without a recorded exit code do not
match an exit-code filter. A recorded zero is an outcome, not permission to apply.

Filtering uses the existing bounded metadata index and precedes twelve-row
pagination. Corrupt indexes remain counted separately as unavailable; they are
never treated as passed results. No report is opened, verification rerun, file
pruned or apply capability created by a search.


## Compare two saved verification records

History now has independent earlier/later record selectors. Pick two verification
records from their rows or enter their IDs, then compare. This reads their existing
metadata and digest-bound bodies; it never calls the verifier, changes the current
selection/baseline, consumes an approved plan or grants repair permission. Leaving
the history view, changing an ID or cancelling discards obsolete replies while
retaining the entered IDs and unrelated drafts. Comparisons use one bounded read
slot; a second concurrent comparison receives a recoverable busy response.

Both records must describe the same saved directory identity and verification
mode. Skill reports require matching declared targets and complete, unsaturated
comparison fields, consistent summaries and finding coverage, unique issue IDs and
matching recorded exit codes. The same owner computes fresh-baseline and historical
issue differences, including pairing changed evidence at the same code/location.
The result distinguishes new, continuing, no-longer-observed and changed evidence;
no-longer-observed findings are not certified fixes. Old reports do not record
all tool/policy conditions, so identical selection is not a controlled regression.

Artifact records retain the existing contract, declaration and receipt-bound
comparison rules. Their finding counts stay separate from per-check changes.
Different selections/contracts, incomplete or invalid evidence remain unavailable;
they do not produce invented zero counts. Corrupt or changed stored bodies fail
before comparison. Current source directories and contract files need not exist:
this is an offline comparison of saved evidence, not a fresh physical-file check.

POST `/api/history/compare` accepts `beforeId` and `afterId` under the existing
loopback origin and session guards. History still caps state at 120 files/64 MiB,
metadata at 16 KiB and each body at 8 MiB. Early row/field caps precede deep schema
parsing; saturated 256-row/unknown evidence is unavailable. At most 32 code/count
or reconciliation-index details reach the browser, with full accepted counts and
explicit truncation. Raw finding messages, source paths, cells, recipes and backup
paths are not returned. No history or receipt is rewritten.

The workflow borrows [Qodana's baseline distinctions](https://www.jetbrains.com/help/qodana/baseline.html)
while preserving this workbench's local, non-authenticated evidence boundary.


## Reconnect to a running local operation (current source)

Refreshing or reopening the workbench now reads a small authenticated operation snapshot before enabling a new action. If the same server is still working, the page shows the current kind/phase and any pending cancellation; it does not restore the old selected-directory authority, plan, report-as-current or confirmation checkbox. Entered form nodes are not replaced by polling. A readonly status read never invokes the CLI or changes a plan/history record.

`POST /api/operation` uses the existing loopback Host/Origin/nonce guards. It returns at most the current and most recent operation: opaque UUID, fixed kind/phase/outcome, times and optional saved-history UUID. No source/output path, PID, command, report body, plan or mutation capability is returned. These are request lifecycle outcomes, not a passing verification verdict. After server restart both in-memory entries are empty and the nonce changes; immutable history remains. An old apply-intent still needs the original evidence and a fresh recheck.

Accepted write/inspection operations receive a fresh operation UUID; cancellation must name the exact current UUID. Missing/stale IDs return409 and cannot stop a later command. Apply and finalizing/uncancellable read phases refuse cancellation. Repeated cancellation of the same active operation is idempotent, with one bounded SIGTERM→2s SIGKILL path; shutdown also reaps its own child, including an open system picker. Cancellation may precede child dispatch but never authorizes a retry. A batch/apply submitted outcome without its final evidence remains unconfirmed.

The reconnect view owns at most one status fetch/controller and one2s polling timer, limited to90 automatic reads while observing a background operation. Hidden/leaving pages cancel status reads and timers; returning checks again. A status read that fails or cannot be validated keeps write controls unavailable until explicit recheck. The page never automatically cancels the server job on disconnect. It discards late operation/plan replies after leaving, including a browser back/forward cache return; old apply confirmation is not revived. Completion offers historical review, not automatic selection, rerun or apply.

Existing history comparison remains separately readonly, with its own concurrency guards. Reports/plans/receipts retain120-file/64MiB storage limits. This source addition neither publishes npm/GitHub downloads nor enables live Skill/provider/remote-worker execution.

A page leaving for navigation also releases its report string and hides the old result view. Returning from the browser cache cannot display that prior report as the current result; its immutable history record is retained and can be reopened explicitly. Form path nodes are not cleared by status polling.

Local source validation:766 tests passed,1 optional Docker-reference test skipped; type checking,lint and build passed. Native synthetic Chrome390px covered refresh/current ID, stale cancel refusal, apply-in-progress refresh/refusal, explicit safe fixture fix, server restart/old nonce denial and browser return with the old report hidden. Seven immutable history files stayed byte-identical. The Skill script was never executed; Provider calls0. Formal release and external business acceptance remain separate.

修复备份位于私有状态目录内的 `repair-backups/`，由独立的16次操作上限管理，不计入核验报告的64MiB/120文件计数。历史索引失败后保留的材料会显示为未完成，不计作核验成功。恢复与旧临时备份兼容边界见[修复与恢复](repair-recovery.md)。
