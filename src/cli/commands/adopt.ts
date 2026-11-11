import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runLock, type LockOptions } from "./lock.js";
import type { SkillLock } from "../../domain/lockfile.js";

export type AdoptOptions = Omit<LockOptions, "from" | "check"> & {
  plan?: boolean;
  apply?: boolean;
  output?: string;
  backup?: boolean;
  force?: boolean;
  yes?: boolean;
};

export type AdoptAction = {
  type: "record";
  name: string;
};

export type AdoptReport = {
  schema_version: 1;
  mode: "plan" | "applied";
  actions: AdoptAction[];
  lock: SkillLock;
  outputPath?: string;
  backupPath?: string;
  exitCode: 0;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function regularFileExists(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function actionsFor(lock: SkillLock): AdoptAction[] {
  return Object.keys(lock.skills)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ type: "record" as const, name }));
}

function lockContent(lock: SkillLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

async function applyLock(lock: SkillLock, options: AdoptOptions): Promise<Pick<AdoptReport, "outputPath" | "backupPath">> {
  if (!options.yes) {
    throw new Error("adopt --apply requires --yes to confirm the write.");
  }
  if (!options.output) {
    throw new Error("adopt --apply requires --output <lock-file>.");
  }

  const outputPath = resolve(options.output);
  const exists = await pathExists(outputPath);
  if (exists && !(await regularFileExists(outputPath))) {
    throw new Error(`Adopt output must be a regular file: ${outputPath}`);
  }
  if (exists && !options.force) {
    throw new Error(`Adopt output already exists; pass --force to replace it: ${outputPath}`);
  }
  if (exists && !options.backup) {
    throw new Error("Replacing an adopt output requires --backup.");
  }

  await mkdir(dirname(outputPath), { recursive: true });
  let backupPath: string | undefined;
  if (exists) {
    backupPath = `${outputPath}.bak.${Date.now()}`;
    await copyFile(outputPath, backupPath);
  }

  await writeFile(outputPath, lockContent(lock), {
    encoding: "utf8",
    flag: exists ? "w" : "wx",
  });
  return { outputPath, ...(backupPath ? { backupPath } : {}) };
}

export async function runAdopt(options: AdoptOptions): Promise<AdoptReport> {
  if (options.plan && options.apply) {
    throw new Error("adopt accepts either --plan or --apply, not both.");
  }

  const lockReport = await runLock({ paths: options.paths });
  const actions = actionsFor(lockReport.lock);
  if (!options.apply) {
    return {
      schema_version: 1,
      mode: "plan",
      actions,
      lock: lockReport.lock,
      exitCode: 0,
    };
  }

  const applied = await applyLock(lockReport.lock, options);
  return {
    schema_version: 1,
    mode: "applied",
    actions,
    lock: lockReport.lock,
    ...applied,
    exitCode: 0,
  };
}

export function renderAdopt(report: AdoptReport, format: string | undefined): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  if (format !== undefined && format !== "text") {
    throw new Error(`Unsupported adopt output format: ${format}`);
  }

  const lines = [
    `Adopt ${report.mode}: ${report.actions.length} Skill(s)`,
    ...report.actions.map((action) => `- [${action.type}] ${action.name}`),
  ];
  if (report.mode === "plan") {
    lines.push("No files written. Use --apply --yes with an explicit --output to write the lock snapshot.");
  } else if (report.outputPath) {
    lines.push(`Wrote ${report.outputPath}`);
    if (report.backupPath) {
      lines.push(`Backup: ${report.backupPath}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
