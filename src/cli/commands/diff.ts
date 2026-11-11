import { resolve } from "node:path";

import { parseSkillDocument } from "../../domain/frontmatter.js";
import { normalizeRelativePath } from "../../domain/digest.js";
import { scanInventory, type ScanTarget } from "../../domain/inventory.js";
import {
  compareSkills,
  type SemanticChange,
  type SemanticChangeKind,
} from "../../domain/semantic-diff.js";
import type { Skill } from "../../domain/skill.js";

export type DiffOptions = {
  beforePath: string;
  afterPath: string;
};

export type DiffSkillSummary = Pick<Skill, "name" | "rootPath" | "digest">;

export type DiffReport = {
  schema_version: 1;
  before: DiffSkillSummary;
  after: DiffSkillSummary;
  changes: SemanticChange[];
  summary: {
    total: number;
    by_kind: Record<SemanticChangeKind, number>;
  };
};

const CHANGE_KINDS: SemanticChangeKind[] = [
  "routing-change",
  "capability-change",
  "compatibility-loss",
  "provenance-change",
  "resource-change",
  "policy-change",
];

function targetForPath(path: string, label: "before" | "after"): ScanTarget {
  return {
    name: `diff-${label}`,
    path: resolve(path),
    scope: "explicit",
  };
}

function hydrateFrontmatter(skill: Skill, label: "before" | "after"): Skill {
  const skillMd = skill.files.find((file) => {
    try {
      return normalizeRelativePath(file.relativePath) === "SKILL.md";
    } catch {
      return false;
    }
  });

  if (!skillMd) {
    throw new Error(`Cannot diff ${label} Skill: SKILL.md was not found.`);
  }

  const parsed = parseSkillDocument(skillMd.content.toString("utf8"));
  if (!parsed.ok) {
    throw new Error(`Cannot diff ${label} Skill ${skill.name}: ${parsed.error}`);
  }

  return { ...skill, frontmatter: parsed.value.frontmatter };
}

async function loadSingleSkill(path: string, label: "before" | "after"): Promise<Skill> {
  const inventory = await scanInventory([targetForPath(path, label)]);
  if (inventory.skills.length !== 1) {
    const detail = inventory.findings[0]?.message;
    const suffix = detail ? ` ${detail}` : "";
    throw new Error(
      `Diff ${label} path must resolve to exactly one Skill: ${resolve(path)}.${suffix}`,
    );
  }

  return hydrateFrontmatter(inventory.skills[0], label);
}

function summarizeChanges(changes: SemanticChange[]): Record<SemanticChangeKind, number> {
  const summary = Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, 0])) as Record<
    SemanticChangeKind,
    number
  >;
  for (const change of changes) {
    summary[change.kind] += 1;
  }
  return summary;
}

export async function runDiff(options: DiffOptions): Promise<DiffReport> {
  const [before, after] = await Promise.all([
    loadSingleSkill(options.beforePath, "before"),
    loadSingleSkill(options.afterPath, "after"),
  ]);
  const changes = compareSkills(before, after);

  return {
    schema_version: 1,
    before: {
      name: before.name,
      rootPath: before.rootPath,
      digest: before.digest,
    },
    after: {
      name: after.name,
      rootPath: after.rootPath,
      digest: after.digest,
    },
    changes,
    summary: {
      total: changes.length,
      by_kind: summarizeChanges(changes),
    },
  };
}

export function renderDiff(report: DiffReport, format: string | undefined): string {
  if (format === undefined || format === "text") {
    const lines = [
      `Semantic diff: ${report.before.name} -> ${report.after.name}`,
      `Before: ${report.before.rootPath} (${report.before.digest})`,
      `After:  ${report.after.rootPath} (${report.after.digest})`,
      `Changes: ${report.summary.total}`,
    ];

    if (report.changes.length === 0) {
      lines.push("No semantic changes detected.");
    } else {
      for (const change of report.changes) {
        lines.push(`- [${change.kind}] ${change.summary}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  throw new Error(`Unsupported diff output format: ${format}`);
}
