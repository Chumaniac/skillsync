# Workbench history and rechecks

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
