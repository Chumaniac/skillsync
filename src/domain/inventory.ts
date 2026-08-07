import { lstat, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { computeSkillDigest, normalizeRelativePath } from "./digest.js";
import type { Finding } from "./result.js";
import type { Skill, SkillFile } from "./skill.js";

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
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  const visitedDirectories = new Set<string>();
  const canonicalRoot = await realpath(skillRoot);

  async function walk(directory: string): Promise<void> {
    const canonicalDirectory = await realpath(directory);
    if (visitedDirectories.has(canonicalDirectory)) {
      return;
    }
    visitedDirectories.add(canonicalDirectory);

    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = normalizeRelativePath(relative(skillRoot, fullPath));
      const metadata = await lstat(fullPath);

      if (metadata.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (metadata.isSymbolicLink()) {
        const linkTarget = await readlink(fullPath);
        await addBrokenSymlinkFinding(findings, skillName, target, fullPath);

        if (options.followSymlinks && !(await isBrokenSymlink(fullPath))) {
          const canonicalTarget = await realpath(fullPath);
          if (isPathInside(canonicalRoot, canonicalTarget)) {
            const targetMetadata = await stat(fullPath);
            if (targetMetadata.isDirectory()) {
              await walk(fullPath);
              continue;
            }
            if (targetMetadata.isFile()) {
              files.push({
                relativePath,
                content: await readFile(fullPath),
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

        files.push({
          relativePath,
          content: Buffer.from(linkTarget),
          mode: metadata.mode,
          isSymlink: true,
        });
        continue;
      }

      if (metadata.isFile()) {
        files.push({
          relativePath,
          content: await readFile(fullPath),
          mode: metadata.mode,
          isSymlink: false,
        });
      }
    }
  }

  await walk(skillRoot);
  return files;
}

async function discoverSkillRoots(
  target: ScanTarget,
  options: InventoryOptions,
): Promise<string[]> {
  const targetPath = resolve(target.path);
  if (await hasSkillMd(targetPath)) {
    return [targetPath];
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  const roots: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (await hasSkillMd(entryPath)) {
        roots.push(entryPath);
      }
      continue;
    }

    if (entry.isSymbolicLink() && options.followSymlinks && !(await isBrokenSymlink(entryPath))) {
      const canonicalTarget = await realpath(entryPath);
      if (isPathInside(await realpath(targetPath), canonicalTarget) && (await stat(entryPath)).isDirectory()) {
        if (await hasSkillMd(entryPath)) {
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
): Promise<{ skills: Skill[]; findings: Finding[] }> {
  const findings: Finding[] = [];
  const skills: Skill[] = [];
  const targetPath = resolve(target.path);

  try {
    const metadata = await lstat(targetPath);
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

  const roots = await discoverSkillRoots(target, options);
  for (const skillRoot of roots) {
    const skillName = basename(skillRoot);
    const files = await collectFiles(skillRoot, target, skillName, options, findings);
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

  for (const target of targets) {
    const result = await scanTarget(target, options);
    skills.push(...result.skills);
    findings.push(...result.findings);
  }

  addDuplicateFindings(skills, targets, findings);
  return { targets, skills, findings };
}
