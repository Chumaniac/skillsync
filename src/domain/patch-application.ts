import { chmod, link, lstat, mkdir, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { assertActionPlanIntegrity } from "./action-plan.js";
import type { ActionPlan } from "./action-plan.js";
import { normalizeRelativePath } from "./digest.js";
import type { PatchChange } from "./resolution.js";
import { readWorkspaceFile, readWorkspaceText, WORKSPACE_TREE_LIMITS } from "../sandbox/workspace-tree.js";

import { createRepairBackup, syncDirectory } from "./repair-backups.js";

export type ApplyReceipt = {
  schema_version: 1;
  status: "applied" | "restored";
  planDigest: string;
  changedPaths: string[];
  backupPath?: string;
  generatedAt: string;
};

export type RollbackFailure = {
  path: string;
  error: Error;
};

export type ApplyRecovery = {
  schema_version: 1;
  status: "rollback-incomplete";
  planDigest: string;
  backupPath: string;
  changedPaths: string[];
  failedPaths: string[];
  generatedAt: string;
};

export class ActionPlanRollbackError extends Error {
  constructor(readonly failures: RollbackFailure[]) {
    super(`ActionPlan rollback failed for: ${failures.map(({ path }) => path).join(", ")}`);
    this.name = "ActionPlanRollbackError";
  }

  get failedPaths(): string[] {
    return this.failures.map(({ path }) => path);
  }
}

export class ActionPlanApplyError extends Error {
  readonly receipt?: ApplyReceipt;
  readonly rollbackError?: ActionPlanRollbackError;
  readonly recovery?: ApplyRecovery;

  constructor(message: string, details: { receipt?: ApplyReceipt; rollbackError?: ActionPlanRollbackError; recovery?: ApplyRecovery } = {}) {
    super(message);
    this.name = "ActionPlanApplyError";
    if (details.receipt !== undefined) {
      this.receipt = details.receipt;
    }
    if (details.rollbackError !== undefined) {
      this.rollbackError = details.rollbackError;
    }
    if (details.recovery !== undefined) this.recovery = details.recovery;
  }
}

type PreparedChange = {
  change: PatchChange;
  rootPath: string;
  normalizedPath: string;
  targetPath: string;
  content: string;
  mode: number;
  metadata: Stats;
};

type Backup = PreparedChange & {
  backupFilePath: string;
  published?: Stats;
};

function ensureSafePatchPath(path: string): string {
  if (path.length === 0) {
    throw new Error("Patch path must not be empty");
  }

  const normalizedSeparators = path.replaceAll("\\", "/");
  if (normalizedSeparators.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe patch path: ${path}`);
  }

  return normalizeRelativePath(normalizedSeparators);
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const pathFromRoot = relative(rootPath, targetPath);
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

async function assertNoSymlinkedParents(rootPath: string, normalizedPath: string): Promise<void> {
  let parentPath = rootPath;
  for (const segment of normalizedPath.split("/").slice(0, -1)) {
    parentPath = join(parentPath, segment);
    const parentStat = await lstat(parentPath).catch(() => {
      throw new Error(`Patch target parent is missing: ${normalizedPath}`);
    });
    if (parentStat.isSymbolicLink()) {
      throw new Error(`Patch target parent must not be a symlink: ${normalizedPath}`);
    }
    if (!parentStat.isDirectory()) {
      throw new Error(`Patch target parent must be a directory: ${normalizedPath}`);
    }
  }
}

function assertMode(mode: number | undefined, field: "modeBefore" | "modeAfter"): asserts mode is number {
  if (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0o000 || mode > 0o777) {
    throw new Error(`${field} must be an integer between 0000 and 0777`);
  }
}

function hasContentPatch(change: PatchChange): boolean {
  return change.before !== "" || change.after !== "";
}

function hasModeChange(change: PatchChange): boolean {
  return change.modeAfter !== undefined && change.modeAfter !== change.modeBefore;
}

function receiptFor(
  status: ApplyReceipt["status"],
  plan: ActionPlan,
  changedPaths: string[],
  backupPath: string | undefined,
): ApplyReceipt {
  return {
    schema_version: 1,
    status,
    planDigest: plan.planDigest,
    changedPaths: [...changedPaths].sort(),
    ...(backupPath === undefined ? {} : { backupPath }),
    generatedAt: new Date().toISOString(),
  };
}

class TargetRecoveryRequired extends Error {
  constructor(readonly target: string, detail: string) { super(`Target publication requires recovery: ${detail}`); }
}
async function assertSnapshot(path: string, content: string, mode: number, metadata: Stats): Promise<void> {
  const current = await lstat(path);
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== metadata.dev || current.ino !== metadata.ino || (current.mode & 0o777) !== mode ||
      (await readWorkspaceFile(path, WORKSPACE_TREE_LIMITS.maxFileBytes, current)).toString('utf8') !== content) throw new Error('Patch target changed or is stale.');
}
async function assertTarget(item: PreparedChange, content = item.content, mode = item.mode, metadata = item.metadata): Promise<void> {
  await assertNoSymlinkedParents(item.rootPath, item.normalizedPath);
  await assertSnapshot(item.targetPath, content, mode, metadata);
}
async function replaceFileContents(targetPath: string, content: string, mode: number, capturedPath: string,
  expected: { content: string; mode: number; metadata: Stats }, beforeCommit: () => Promise<void>): Promise<Stats> {
  const temporaryPath = join(dirname(targetPath), `.skillsync-apply-${randomUUID()}.tmp`);
  const probePath = `${temporaryPath}.link-check`;
  let captured = false, published = false;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode });
    await chmod(temporaryPath, mode);
    const handle = await open(temporaryPath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
    let metadata: Stats;
    try { await handle.sync(); metadata = await handle.stat(); } finally { await handle.close(); }
    // Refuse unsupported filesystems while the original target is still intact.
    await link(temporaryPath, probePath); await rm(probePath);
    await mkdir(dirname(capturedPath), { recursive: true, mode: 0o700 });
    await beforeCommit();
    // Capture the actual directory entry before publication. A concurrent new file
    // is never replaced: link() fails if any writer has populated the target name.
    await rename(targetPath, capturedPath); captured = true;
    await syncDirectory(dirname(capturedPath));
    await assertSnapshot(capturedPath, expected.content, expected.mode, expected.metadata);
    await link(temporaryPath, targetPath); published = true;
    return metadata;
  } catch (error) {
    if (captured && !published) {
      try { await link(capturedPath, targetPath); await syncDirectory(dirname(targetPath)); }
      catch { throw new TargetRecoveryRequired(targetPath, error instanceof Error ? error.message : 'conflicting publication'); }
    }
    throw error;
  } finally { await rm(probePath, { force: true }).catch(() => undefined); await rm(temporaryPath, { force: true }).catch(() => undefined); }
}
async function changeMode(item: PreparedChange, mode: number, before: () => Promise<void>): Promise<void> {
  const handle = await open(item.targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const bound = await handle.stat(); await before();
    if (bound.dev !== item.metadata.dev || bound.ino !== item.metadata.ino) throw new Error('Patch target changed before mode update.');
    await handle.chmod(mode);
  } finally { await handle.close(); }
}
async function restoreBackup(backup: Backup, checkRoot: () => Promise<void>, directory: string): Promise<void> {
  const check = async () => {
    await checkRoot();
    await assertTarget(backup, hasContentPatch(backup.change) ? backup.change.after : backup.content, backup.change.modeAfter ?? backup.mode, backup.published ?? backup.metadata);
  };
  if (hasContentPatch(backup.change)) await replaceFileContents(backup.targetPath, await readWorkspaceText(backup.backupFilePath, WORKSPACE_TREE_LIMITS.maxFileBytes), backup.mode, join(directory, "rollback", backup.normalizedPath), { content: backup.change.after, mode: backup.change.modeAfter ?? backup.mode, metadata: backup.published ?? backup.metadata }, check);
  else await changeMode(backup, backup.mode, check);
}

async function restoreChangedTargets(changed: Backup[], checkRoot: () => Promise<void>, directory: string): Promise<RollbackFailure[]> {
  const failures: RollbackFailure[] = [];
  for (const backup of [...changed].reverse()) {
    try {
      await checkRoot();
      await restoreBackup(backup, checkRoot, directory);
    } catch (error) {
      failures.push({
        path: backup.normalizedPath,
        error: error instanceof Error ? error : new Error("unknown rollback failure"),
      });
    }
  }
  return failures;
}

export async function applyActionPlan(
  plan: ActionPlan,
  options: {
    yes: boolean;
    approveReviewRequired?: boolean;
    backup?: boolean;
    backupDirectory?: string;
  },
): Promise<ApplyReceipt> {
  if (!options.yes) {
    throw new Error("Applying an ActionPlan requires --yes");
  }

  assertActionPlanIntegrity(plan);

  const rootPath = await realpath(plan.rootPath).catch(() => {
    throw new Error("ActionPlan rootPath must resolve to an existing directory");
  });
  if (!(await stat(rootPath)).isDirectory()) {
    throw new Error("ActionPlan rootPath must resolve to an existing directory");
  }
  async function checkRoot(): Promise<void> {
    // Older CLI plans remain readable; newly generated plans bind the reviewed
    // directory independently of its content digest, including in the child CLI.
    if (plan.rootIdentity === undefined) return;
    const metadata = await lstat(rootPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
        `${metadata.dev}:${metadata.ino}` !== plan.rootIdentity || await realpath(plan.rootPath) !== rootPath) {
      throw new Error("Skill directory was replaced; verify it and create a new plan.");
    }
  }
  await checkRoot();

  const prepared: PreparedChange[] = [];
  const paths = new Set<string>();
  let preparedBytes = 0, patchedBytes = 0;
  if (plan.changes.length > WORKSPACE_TREE_LIMITS.maxFiles) throw new Error("Too many repair targets.");
  for (const change of plan.changes) {
    const normalizedPath = ensureSafePatchPath(change.path);
    const outputBytes = Buffer.byteLength(change.after); patchedBytes += outputBytes;
    if (outputBytes > WORKSPACE_TREE_LIMITS.maxFileBytes || patchedBytes > WORKSPACE_TREE_LIMITS.maxTotalBytes) throw new Error("Repair output exceeds the bounded workspace limit.");
    if (paths.has(normalizedPath)) {
      throw new Error(`Duplicate normalized patch path: ${normalizedPath}`);
    }
    paths.add(normalizedPath);

    if (change.modeAfter !== undefined) {
      assertMode(change.modeAfter, "modeAfter");
      if (change.modeBefore === undefined) {
        throw new Error("modeAfter requires modeBefore");
      }
      assertMode(change.modeBefore, "modeBefore");
    }
    if (change.before === change.after && !hasModeChange(change)) {
      throw new Error(`Patch change is a no-op: ${normalizedPath}`);
    }

    const targetPath = resolve(rootPath, normalizedPath);
    if (!isWithinRoot(rootPath, targetPath)) {
      throw new Error(`Patch path escapes ActionPlan root: ${change.path}`);
    }
    await assertNoSymlinkedParents(rootPath, normalizedPath);

    const targetStat = await lstat(targetPath).catch(() => {
      throw new Error(`Patch target is missing: ${normalizedPath}`);
    });
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error(`Patch target must be a regular non-symlink file: ${normalizedPath}`);
    }

    const mode = targetStat.mode & 0o777;
    const content = await readWorkspaceText(targetPath, WORKSPACE_TREE_LIMITS.maxFileBytes);
    preparedBytes += Buffer.byteLength(content);
    if (preparedBytes > WORKSPACE_TREE_LIMITS.maxTotalBytes) throw new Error("Repair input exceeds the bounded workspace limit.");
    if (hasContentPatch(change) && content !== change.before) {
      throw new Error(`Patch target content is stale: ${normalizedPath}`);
    }
    if (change.modeBefore !== undefined && mode !== change.modeBefore) {
      throw new Error(`Patch target mode is stale: ${normalizedPath}`);
    }
    if (!hasContentPatch(change)) {
      if (change.modeBefore === undefined || change.modeAfter === undefined) {
        throw new Error(`Mode-only patch requires modeBefore and modeAfter: ${normalizedPath}`);
      }
      if (change.modeAfter > change.modeBefore) {
        throw new Error(`Mode-only patch must not increase permissions: ${normalizedPath}`);
      }
    }

    prepared.push({ change, rootPath, normalizedPath, targetPath, content, mode, metadata: targetStat });
  }

  if (prepared.some(({ change }) => change.safety === "review-required") && !options.approveReviewRequired) {
    throw new Error("Review-required ActionPlan changes need explicit approval");
  }

  if (options.backupDirectory && isWithinRoot(rootPath, resolve(options.backupDirectory))) throw new Error("Repair backups must be outside the Skill directory.");
  const retained = await createRepairBackup(prepared, plan.planDigest, options.backupDirectory);
  const temporaryBackupPath = retained.directory;
  const backups: Backup[] = prepared.map(item => ({ ...item, backupFilePath: join(retained.directory, 'files', item.normalizedPath) }));

  const retainedMetadata = await stat(retained.directory);
  if (backups.some(item => item.metadata.dev !== (retainedMetadata.dev))) { await rm(retained.slot, { force:true, recursive:true }); throw new Error("Repair backups must be on the same filesystem as every target; select --backup-dir on that filesystem."); }
  const changed: Backup[] = [];
  try {
    for (const backup of backups) {
      const check = async () => { await checkRoot(); await assertTarget(backup); };
      if (hasContentPatch(backup.change)) {
        backup.published = await replaceFileContents(backup.targetPath, backup.change.after, backup.change.modeAfter ?? backup.mode, join(retained.directory, "captured", backup.normalizedPath), backup, check);
        changed.push(backup);
      } else if (backup.change.modeAfter !== undefined) {
        await changeMode(backup, backup.change.modeAfter, check); changed.push(backup);
      }
    }
    await checkRoot();
    for (const backup of changed) await assertTarget(backup, hasContentPatch(backup.change) ? backup.change.after : backup.content, backup.change.modeAfter ?? backup.mode, backup.published ?? backup.metadata);
    for (const parent of new Set(changed.map(item => dirname(item.targetPath)))) await syncDirectory(parent);

  } catch (error) {
    const rollbackFailures = await restoreChangedTargets(changed, checkRoot, retained.directory);
    if (error instanceof TargetRecoveryRequired) rollbackFailures.push({path: relative(rootPath,error.target).split(sep).join("/"),error});
    const detail = error instanceof Error ? error.message : "unknown write failure";
    if (rollbackFailures.length > 0) {
      const rollbackError = new ActionPlanRollbackError(rollbackFailures);
      const recovery: ApplyRecovery = {
        schema_version: 1, status: "rollback-incomplete", planDigest: plan.planDigest,
        backupPath: temporaryBackupPath, changedPaths: changed.map(item => item.normalizedPath),
        failedPaths: rollbackError.failedPaths, generatedAt: new Date().toISOString(),
      };
      throw new ActionPlanApplyError(`ActionPlan application failed and rollback was incomplete: ${detail}`, { rollbackError, recovery });
    }
    // Failure backups are retained even when success backups were disabled.
    // Always expose their location instead of leaving undiscoverable materials.
    const receipt = receiptFor("restored", plan, changed.map((item) => item.normalizedPath), temporaryBackupPath);
    throw new ActionPlanApplyError(`ActionPlan application failed; restored prior changes: ${detail}`, { receipt });
  }

  if (options.backup === false) {
    await rm(retained.slot, { force: true, recursive: true });
  }

  return receiptFor(
    "applied",
    plan,
    backups.map((item) => item.normalizedPath),
    options.backup === false ? undefined : temporaryBackupPath,
  );
}
