import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { scanInventory } from "../../domain/inventory.js";
import { validateLock, type SkillLock } from "../../domain/lockfile.js";
import type { Finding } from "../../domain/result.js";
import type { Skill } from "../../domain/skill.js";

export type LockOptions = {
  paths: string[];
  from?: string;
  check?: boolean;
};

type LockCheckStatus = "pass" | "fail";

export type LockCheckEntry = {
  name: string;
  status: LockCheckStatus;
  expected_digest?: string;
  actual_digest?: string;
  message: string;
};

export type LockCheckReport = {
  skills: LockCheckEntry[];
  inventory_findings: Finding[];
  summary: {
    pass: number;
    fail: number;
  };
};

export type LockReport = {
  schema_version: 1;
  mode: "generated" | "loaded" | "check";
  lock: SkillLock;
  check?: LockCheckReport;
  exitCode: 0 | 1;
};

const DEFAULT_PATHS = [".agents/skills", ".claude/skills", ".cursor/skills"];

function parseLockJson(content: string, path: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
    throw new Error(`Cannot parse lock file ${path}: ${message}`);
  }
}

async function readLock(path: string): Promise<SkillLock> {
  const resolvedPath = resolve(path);
  let content: string;
  try {
    content = await readFile(resolvedPath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
    throw new Error(`Cannot read lock file ${resolvedPath}: ${message}`);
  }

  try {
    return validateLock(parseLockJson(content, resolvedPath));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
    throw new Error(`Invalid lock file ${resolvedPath}: ${message}`);
  }
}

function generatedLock(skills: Skill[]): SkillLock {
  const entries = new Map<string, Skill>();
  for (const skill of skills) {
    const previous = entries.get(skill.name);
    if (previous && previous.digest !== skill.digest) {
      throw new Error(`Cannot generate lock: Skill ${skill.name} has conflicting digests.`);
    }
    entries.set(skill.name, skill);
  }

  const normalizedSkills = Object.fromEntries(
    [...entries.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, skill]) => [
      name,
      {
        source: skill.source,
        content_digest: skill.digest,
        targets: {},
      },
    ]),
  );

  return validateLock({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    skills: normalizedSkills,
  });
}

function checkLock(lock: SkillLock, skills: Skill[], inventoryFindings: Finding[]): LockCheckReport {
  const currentByName = new Map<string, Skill[]>();
  for (const skill of skills) {
    const group = currentByName.get(skill.name) ?? [];
    group.push(skill);
    currentByName.set(skill.name, group);
  }

  const entries: LockCheckEntry[] = [];
  for (const [name, locked] of Object.entries(lock.skills).sort(([left], [right]) => left.localeCompare(right))) {
    const current = currentByName.get(name) ?? [];
    if (current.length === 0) {
      entries.push({
        name,
        status: "fail",
        expected_digest: locked.content_digest,
        message: "Skill is present in the lock but missing from the scanned paths.",
      });
      continue;
    }

    if (current.length > 1) {
      entries.push({
        name,
        status: "fail",
        expected_digest: locked.content_digest,
        actual_digest: current[0]?.digest,
        message: "Multiple Skill copies were found; lock verification is ambiguous.",
      });
      continue;
    }

    const actual = current[0];
    if (!locked.content_digest) {
      entries.push({
        name,
        status: "fail",
        actual_digest: actual.digest,
        message: "Lock entry has no SkillSync content digest; regenerate the lock before checking content.",
      });
      continue;
    }
    if (actual.digest === locked.content_digest) {
      entries.push({
        name,
        status: "pass",
        expected_digest: locked.content_digest,
        actual_digest: actual.digest,
        message: "Skill content matches the lock.",
      });
    } else {
      entries.push({
        name,
        status: "fail",
        expected_digest: locked.content_digest,
        actual_digest: actual.digest,
        message: "Skill content digest differs from the lock.",
      });
    }
  }

  for (const [name, current] of [...currentByName.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (name in lock.skills) {
      continue;
    }
    for (const skill of current) {
      entries.push({
        name,
        status: "fail",
        actual_digest: skill.digest,
        message: "Skill was found in the scanned paths but is absent from the lock.",
      });
    }
  }

  const pass = entries.filter((entry) => entry.status === "pass").length;
  return {
    skills: entries,
    inventory_findings: inventoryFindings,
    summary: { pass, fail: entries.length - pass },
  };
}

export async function runLock(options: LockOptions): Promise<LockReport> {
  if (options.check && !options.from) {
    throw new Error("lock --check requires --from <lock-file>.");
  }

  const paths = options.paths.length > 0 ? options.paths : DEFAULT_PATHS;
  if (options.from) {
    const lock = await readLock(options.from);
    if (!options.check) {
      return { schema_version: 1, mode: "loaded", lock, exitCode: 0 };
    }

    const inventory = await scanInventory(
      paths.map((path, index) => ({
        name: `lock-check-${index + 1}`,
        path: resolve(path),
        scope: "explicit" as const,
      })),
    );
    const check = checkLock(lock, inventory.skills, inventory.findings);
    return {
      schema_version: 1,
      mode: "check",
      lock,
      check,
      exitCode: check.summary.fail === 0 ? 0 : 1,
    };
  }

  const inventory = await scanInventory(
    paths.map((path, index) => ({
      name: `lock-generate-${index + 1}`,
      path: resolve(path),
      scope: "explicit" as const,
    })),
  );
  return {
    schema_version: 1,
    mode: "generated",
    lock: generatedLock(inventory.skills),
    exitCode: 0,
  };
}

export function renderLock(report: LockReport, format: string | undefined): string {
  if (format === "json") {
    return `${JSON.stringify(report.mode === "check" ? report : report.lock, null, 2)}\n`;
  }

  if (format !== undefined && format !== "text") {
    throw new Error(`Unsupported lock output format: ${format}`);
  }

  const skillEntries = Object.entries(report.lock.skills);
  if (report.mode === "check" && report.check) {
    const lines = [
      `Lock check: ${report.check.summary.pass} pass, ${report.check.summary.fail} fail`,
    ];
    for (const entry of report.check.skills) {
      lines.push(`- [${entry.status}] ${entry.name}: ${entry.message}`);
    }
    return `${lines.join("\n")}\n`;
  }

  const action = report.mode === "generated" ? "generated" : "valid";
  const lines = [`Lock ${action}: ${skillEntries.length} Skill(s)`];
  for (const [name, entry] of skillEntries) {
    lines.push(`- ${name}: ${entry.content_digest}`);
  }
  return `${lines.join("\n")}\n`;
}
