import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { planDigest } from "./action-plan.js";
import type { ActionPlan } from "./action-plan.js";
import { normalizeRelativePath } from "./digest.js";
import type { PatchChange } from "./resolution.js";

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

  constructor(message: string, details: { receipt?: ApplyReceipt; rollbackError?: ActionPlanRollbackError } = {}) {
    super(message);
    this.name = "ActionPlanApplyError";
    if (details.receipt !== undefined) {
      this.receipt = details.receipt;
    }
    if (details.rollbackError !== undefined) {
      this.rollbackError = details.rollbackError;
    }
  }
}

type PreparedChange = {
  change: PatchChange;
  normalizedPath: string;
  targetPath: string;
  content: string;
  mode: number;
};

type Backup = PreparedChange & {
  backupFilePath: string;
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

async function replaceFileContents(targetPath: string, content: string, mode: number): Promise<void> {
  const temporaryPath = join(dirname(targetPath), `.skillsync-apply-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function restoreBackup(backup: Backup): Promise<void> {
  await replaceFileContents(backup.targetPath, await readFile(backup.backupFilePath, "utf8"), backup.mode);
  await chmod(backup.targetPath, backup.mode);
}

async function restoreChangedTargets(changed: Backup[]): Promise<RollbackFailure[]> {
  const failures: RollbackFailure[] = [];
  for (const backup of [...changed].reverse()) {
    try {
      await restoreBackup(backup);
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
  },
): Promise<ApplyReceipt> {
  if (!options.yes) {
    throw new Error("Applying an ActionPlan requires --yes");
  }

  const expectedDigest = planDigest({
    schema_version: plan.schema_version,
    rootPath: plan.rootPath,
    issueIds: plan.issueIds,
    changes: plan.changes,
    manualSteps: plan.manualSteps,
  });
  if (plan.planDigest !== expectedDigest) {
    throw new Error("ActionPlan digest does not match its contents");
  }

  const rootPath = await realpath(plan.rootPath).catch(() => {
    throw new Error("ActionPlan rootPath must resolve to an existing directory");
  });
  if (!(await stat(rootPath)).isDirectory()) {
    throw new Error("ActionPlan rootPath must resolve to an existing directory");
  }

  const prepared: PreparedChange[] = [];
  const paths = new Set<string>();
  for (const change of plan.changes) {
    const normalizedPath = ensureSafePatchPath(change.path);
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
    const content = await readFile(targetPath, "utf8");
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

    prepared.push({ change, normalizedPath, targetPath, content, mode });
  }

  if (prepared.some(({ change }) => change.safety === "review-required") && !options.approveReviewRequired) {
    throw new Error("Review-required ActionPlan changes need explicit approval");
  }

  const temporaryBackupPath = await mkdtemp(join(tmpdir(), "skillsync-action-plan-"));
  const backups: Backup[] = [];
  for (const item of prepared) {
    const backupFilePath = join(temporaryBackupPath, "files", item.normalizedPath);
    await mkdir(dirname(backupFilePath), { recursive: true });
    await writeFile(backupFilePath, item.content, { encoding: "utf8", mode: item.mode });
    await chmod(backupFilePath, item.mode);
    backups.push({ ...item, backupFilePath });
  }

  const changed: Backup[] = [];
  try {
    for (const backup of backups) {
      if (hasContentPatch(backup.change)) {
        await replaceFileContents(backup.targetPath, backup.change.after, backup.change.modeAfter ?? backup.mode);
        changed.push(backup);
      }
      if (backup.change.modeAfter !== undefined) {
        await chmod(backup.targetPath, backup.change.modeAfter);
        if (!changed.includes(backup)) {
          changed.push(backup);
        }
      }
    }
  } catch (error) {
    const rollbackFailures = await restoreChangedTargets(changed);
    const detail = error instanceof Error ? error.message : "unknown write failure";
    if (rollbackFailures.length > 0) {
      const rollbackError = new ActionPlanRollbackError(rollbackFailures);
      throw new ActionPlanApplyError(`ActionPlan application failed and rollback was incomplete: ${detail}`, { rollbackError });
    }
    const retainedBackupPath = options.backup === false ? undefined : temporaryBackupPath;
    const receipt = receiptFor("restored", plan, changed.map((item) => item.normalizedPath), retainedBackupPath);
    throw new ActionPlanApplyError(`ActionPlan application failed; restored prior changes: ${detail}`, { receipt });
  }

  if (options.backup === false) {
    await rm(temporaryBackupPath, { force: true, recursive: true });
  }

  return receiptFor(
    "applied",
    plan,
    backups.map((item) => item.normalizedPath),
    options.backup === false ? undefined : temporaryBackupPath,
  );
}
