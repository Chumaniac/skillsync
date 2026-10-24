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

## 2026-10-24 历史读取与核验并发

启动或刷新历史时可以直接核验目录。历史列表保持只读，不占用核验、计划和应用的操作锁；如果新结果产生时旧列表仍在读取，完成后补读最新首屏。取消核验及修复写入的互斥保护继续有效。

本机合成并发回归修复前失败、修复后通过；679项检查通过，1项可选Docker跳过，类型、lint和构建通过。安装包与浏览器回验在本轮交付记录核对。
