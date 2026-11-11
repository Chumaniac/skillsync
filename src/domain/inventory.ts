import type { Dirent, Stats } from "node:fs";
import { lstat, opendir, readlink, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { computeSkillDigest, normalizeRelativePath } from "./digest.js";
import type { Finding } from "./result.js";
import type { Skill, SkillFile } from "./skill.js";
import { readWorkspaceFile, WORKSPACE_TREE_LIMITS, WorkspaceTreeError } from "../sandbox/workspace-tree.js";

export const INVENTORY_LIMITS = Object.freeze({
  ...WORKSPACE_TREE_LIMITS,
  maxTargets: 64,
  maxSkills: 1_000,
  maxEntries: 20_000,
  maxDepth: 64,
});
export type InventoryLimits = { [Key in keyof typeof INVENTORY_LIMITS]: number };

class InventoryInputError extends Error {
  readonly exitCode = 2;
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "InventoryInputError";
  }
}

export class InventoryCapacityError extends InventoryInputError {
  constructor(readonly bound: keyof InventoryLimits, limit: number) {
    super("inventory.capacity", `${bound} limit (${limit}) exceeded or unsupported. Scan smaller explicit roots; no partial inventory was returned.`);
    this.name = "InventoryCapacityError";
  }
}

function sameMetadata(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

class InventoryBudget {
  readonly limits: InventoryLimits;
  readonly observations = new Map<string, Stats>();
  entries = 0;
  files = 0;
  bytes = 0;
  skills = 0;

  constructor(options: InventoryOptions) {
    this.limits = { ...INVENTORY_LIMITS, ...options.limits };
    for (const key of Object.keys(INVENTORY_LIMITS) as Array<keyof InventoryLimits>) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > INVENTORY_LIMITS[key]) {
        throw new InventoryCapacityError(key, INVENTORY_LIMITS[key]);
      }
    }
  }

  check(bound: keyof InventoryLimits, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > this.limits[bound]) {
      throw new InventoryCapacityError(bound, this.limits[bound]);
    }
  }

  file(bytes: number): void {
    this.check("maxFileBytes", bytes);
    this.check("maxFiles", this.files + 1);
    this.check("maxTotalBytes", this.bytes + bytes);
    this.files += 1;
    this.bytes += bytes;
  }

  observe(path: string, metadata: Stats): void {
    const previous = this.observations.get(path);
    if (previous && !sameMetadata(previous, metadata)) {
      throw new InventoryInputError("inventory.changed", "Skill input changed during inspection. Retry with fixed input roots.");
    }
    this.observations.set(path, metadata);
  }

  async verifyStable(): Promise<void> {
    for (const [path, before] of this.observations) {
      if (!sameMetadata(before, await lstat(path))) {
        throw new InventoryInputError("inventory.changed", "Skill input changed during inspection. Retry with fixed input roots.");
      }
    }
  }
}

async function readEntries(directory: string, budget: InventoryBudget): Promise<Dirent[]> {
  const entries: Dirent[] = [];
  for await (const entry of await opendir(directory)) {
    budget.check("maxEntries", ++budget.entries);
    if (entry.name.includes("\\") || /\p{Cc}/u.test(entry.name)) {
      throw new InventoryInputError("inventory.path", "Use portable member names without control characters or backslashes.");
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export type ScanTarget = {
  name: string;
  path: string;
  scope: "project" | "user" | "explicit";
  profileId?: string;
};

export type Inventory = {
  targets: ScanTarget[];
  skills: Skill[];
  findings: Finding[];
};

export type InventoryOptions = {
  followSymlinks?: boolean;
  /** Limits may be reduced, but cannot exceed the shared scan ceilings. */
  limits?: Partial<InventoryLimits>;
};

type FindingStatus = Pick<Finding, "level" | "severity" | "status">;

function finding(
  values: FindingStatus &
    Pick<Finding, "code" | "skill" | "message" | "evidence"> &
    Partial<Pick<Finding, "target" | "remediation">>,
): Finding {
  return values;
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function isBrokenSymlink(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    return isMissingError(error);
  }
}

async function hasSkillMd(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(join(path, "SKILL.md"));
    return metadata.isFile() || metadata.isSymbolicLink();
  } catch (error) {
    if (isMissingError(error)) {
      return false;
    }
    throw error;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("../") && !isAbsolute(path));
}

async function addBrokenSymlinkFinding(
  findings: Finding[],
  skillName: string,
  target: ScanTarget,
  relativePath: string,
): Promise<void> {
  if (!(await isBrokenSymlink(relativePath))) {
    return;
  }

  findings.push(
    finding({
      level: 2,
      severity: "warn",
      status: "warn",
      code: "inventory.broken-symlink",
      skill: skillName,
      target: target.name,
      message: `Broken symlink found at ${relativePath}.`,
      evidence: [{ path: relativePath }],
      remediation: "Remove the link or restore its target before sharing the Skill.",
    }),
  );
}

async function collectFiles(
  skillRoot: string,
  target: ScanTarget,
  skillName: string,
  options: InventoryOptions,
  findings: Finding[],
  budget: InventoryBudget,
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const visitedDirectories = new Set<string>();
  const canonicalRoot = await realpath(skillRoot);

  async function walk(directory: string, depth = 0): Promise<void> {
    budget.check("maxDepth", depth);
    const canonicalDirectory = await realpath(directory);
    if (!isPathInside(canonicalRoot, canonicalDirectory)) {
      throw new InventoryInputError("inventory.changed", "A directory escaped the selected Skill root.");
    }
    budget.observe(directory, await lstat(directory));
    budget.observe(canonicalDirectory, await lstat(canonicalDirectory));
    if (visitedDirectories.has(canonicalDirectory)) {
      return;
    }
    visitedDirectories.add(canonicalDirectory);

    const entries = await readEntries(directory, budget);

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = normalizeRelativePath(relative(skillRoot, fullPath));
      const metadata = await lstat(fullPath);
      budget.observe(fullPath, metadata);

      if (metadata.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }

      if (metadata.isSymbolicLink()) {
        const linkTarget = await readlink(fullPath);
        await addBrokenSymlinkFinding(findings, skillName, target, fullPath);

        if (options.followSymlinks && !(await isBrokenSymlink(fullPath))) {
          const canonicalTarget = await realpath(fullPath);
          if (isPathInside(canonicalRoot, canonicalTarget)) {
            const targetMetadata = await stat(fullPath);
            budget.observe(canonicalTarget, targetMetadata);
            if (targetMetadata.isDirectory()) {
              await walk(fullPath, depth + 1);
              continue;
            }
            if (targetMetadata.isFile()) {
              budget.file(targetMetadata.size);
              files.push({
                relativePath,
                content: await readWorkspaceFile(canonicalTarget, budget.limits.maxFileBytes, targetMetadata),
                mode: metadata.mode,
                isSymlink: true,
              });
              continue;
            }
          } else {
            findings.push(
              finding({
                level: 2,
                severity: "warn",
                status: "warn",
                code: "inventory.symlink-outside-root",
                skill: skillName,
                target: target.name,
                message: `Symlink target escapes the Skill root at ${relativePath}.`,
                evidence: [{ path: relativePath, target: linkTarget }],
                remediation: "Keep Skill resources inside the Skill root.",
              }),
            );
          }
        }

        budget.file(Buffer.byteLength(linkTarget));
        files.push({
          relativePath,
          content: Buffer.from(linkTarget),
          mode: metadata.mode,
          isSymlink: true,
        });
        continue;
      }

      if (metadata.isFile()) {
        budget.file(metadata.size);
        files.push({
          relativePath,
          content: await readWorkspaceFile(fullPath, budget.limits.maxFileBytes, metadata),
          mode: metadata.mode,
          isSymlink: false,
        });
      } else {
        throw new InventoryInputError("inventory.unsupported-type", "Skill members must be regular files, directories or explicit symlinks.");
      }
    }
  }

  await walk(skillRoot);
  return files;
}

async function discoverSkillRoots(
  target: ScanTarget,
  options: InventoryOptions,
  budget: InventoryBudget,
): Promise<string[]> {
  const targetPath = resolve(target.path);
  if (await hasSkillMd(targetPath)) {
    budget.check("maxSkills", ++budget.skills);
    return [targetPath];
  }

  const entries = await readEntries(targetPath, budget);
  const roots: string[] = [];
  for (const entry of entries) {
    const entryPath = join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (await hasSkillMd(entryPath)) {
        budget.check("maxSkills", ++budget.skills);
        roots.push(entryPath);
      }
      continue;
    }

    if (entry.isSymbolicLink() && options.followSymlinks && !(await isBrokenSymlink(entryPath))) {
      const canonicalTarget = await realpath(entryPath);
      if (isPathInside(await realpath(targetPath), canonicalTarget) && (await stat(entryPath)).isDirectory()) {
        if (await hasSkillMd(entryPath)) {
          budget.check("maxSkills", ++budget.skills);
          roots.push(entryPath);
        }
      }
    }
  }
  return roots;
}

async function scanTarget(
  target: ScanTarget,
  options: InventoryOptions,
  budget: InventoryBudget,
): Promise<{ skills: Skill[]; findings: Finding[] }> {
  const findings: Finding[] = [];
  const skills: Skill[] = [];
  const targetPath = resolve(target.path);

  try {
    const metadata = await lstat(targetPath);
    budget.observe(targetPath, metadata);
    if (!metadata.isDirectory()) {
      findings.push(
        finding({
          level: 1,
          severity: "warn",
          status: "warn",
          code: "inventory.missing-target",
          skill: target.name,
          target: target.name,
          message: `Scan target is not a directory: ${target.path}.`,
          evidence: [{ path: target.path }],
          remediation: "Point the target at a Skill directory or a directory containing Skills.",
        }),
      );
      return { skills, findings };
    }
  } catch (error) {
    if (!isMissingError(error)) {
      throw error;
    }
    findings.push(
      finding({
        level: 1,
        severity: "warn",
        status: "warn",
        code: "inventory.missing-target",
        skill: target.name,
        target: target.name,
        message: `Scan target does not exist: ${target.path}.`,
        evidence: [{ path: target.path }],
        remediation: "Create the target directory or remove it from the scan configuration.",
      }),
    );
    return { skills, findings };
  }

  const roots = await discoverSkillRoots(target, options, budget);
  for (const skillRoot of roots) {
    const skillName = basename(skillRoot);
    const files = await collectFiles(skillRoot, target, skillName, options, findings, budget);
    const digest = computeSkillDigest(files);
    skills.push({
      name: skillName,
      rootPath: skillRoot,
      skillMdPath: join(skillRoot, "SKILL.md"),
      frontmatter: {},
      files,
      source: { kind: "local" },
      digest,
    });
  }

  return { skills, findings };
}

function addDuplicateFindings(skills: Skill[], targets: ScanTarget[], findings: Finding[]): void {
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const group = groups.get(skill.name) ?? [];
    group.push(skill);
    groups.set(skill.name, group);
  }

  for (const [skillName, group] of groups) {
    if (group.length < 2) {
      continue;
    }

    const digests = new Set(group.map((skill) => skill.digest));
    const identical = digests.size === 1;
    findings.push(
      finding({
        level: identical ? 0 : 2,
        severity: identical ? "info" : "warn",
        status: identical ? "pass" : "warn",
        code: identical ? "inventory.duplicate-identical" : "inventory.duplicate-drift",
        skill: skillName,
        message: identical
          ? `Skill ${skillName} is present in multiple targets with the same digest.`
          : `Skill ${skillName} differs across targets.`,
        evidence: group.map((skill) => ({
          root_path: skill.rootPath,
          digest: skill.digest,
          target: targets.find((candidate) => resolve(candidate.path) === skill.rootPath)?.name ?? "unknown",
        })),
        remediation: identical
          ? "Keep one canonical source and document the intended targets."
          : "Reconcile the Skill copies before distributing another update.",
      }),
    );
  }
}

export async function scanInventory(
  targets: ScanTarget[],
  options: InventoryOptions = {},
): Promise<Inventory> {
  const skills: Skill[] = [];
  const findings: Finding[] = [];
  const budget = new InventoryBudget(options);
  budget.check("maxTargets", targets.length);
  try {
    for (const target of targets) {
      const result = await scanTarget(target, options, budget);
      skills.push(...result.skills);
      findings.push(...result.findings);
    }
    await budget.verifyStable();
  } catch (error) {
    if (error instanceof InventoryInputError) throw error;
    if (error instanceof WorkspaceTreeError || (typeof error === "object" && error !== null && "code" in error)) {
      throw new InventoryInputError("inventory.unreadable", "Skill input is inaccessible or changed. Fix the input and retry; no partial inventory was returned.");
    }
    throw error;
  }

  addDuplicateFindings(skills, targets, findings);
  return { targets, skills, findings };
}
