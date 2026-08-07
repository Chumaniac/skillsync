import { resolve } from "node:path";

import { parseSkillDocument } from "../../domain/frontmatter.js";
import { scanInventory, type Inventory, type ScanTarget } from "../../domain/inventory.js";
import { normalizeRelativePath } from "../../domain/digest.js";
import { evaluateCompatibility } from "../../domain/compatibility.js";
import type { Finding } from "../../domain/result.js";
import type { Skill } from "../../domain/skill.js";
import { loadCapabilityProfiles } from "../../profiles/loader.js";
import type { CapabilityProfile } from "../../profiles/types.js";
import { formatOutput, parseOutputFormat, type OutputFormat } from "../output.js";

export type CompatOptions = {
  paths: string[];
  targets: string[];
  followSymlinks?: boolean;
};

export type CompatibilityReport = {
  schema_version: 1;
  targets: Array<Pick<CapabilityProfile, "id" | "version" | "docsUrl">>;
  skills: Array<Pick<Skill, "name" | "rootPath" | "digest">>;
  findings: Finding[];
  exitCode: 0 | 1;
};

function targetForPath(path: string, index: number): ScanTarget {
  return {
    name: `compat-${index + 1}`,
    path: resolve(path),
    scope: "explicit",
  };
}

function hydrateFrontmatter(skill: Skill): Skill {
  const skillMd = skill.files.find((file) => {
    try {
      return normalizeRelativePath(file.relativePath) === "SKILL.md";
    } catch {
      return false;
    }
  });
  if (!skillMd) {
    return skill;
  }

  const parsed = parseSkillDocument(skillMd.content.toString("utf8"));
  return parsed.ok ? { ...skill, frontmatter: parsed.value.frontmatter } : skill;
}

export async function runCompat(options: CompatOptions): Promise<CompatibilityReport> {
  const paths = options.paths.length > 0 ? options.paths : [".agents/skills", ".claude/skills", ".cursor/skills"];
  const targets = paths.map(targetForPath);
  const inventory: Inventory = await scanInventory(targets, {
    followSymlinks: options.followSymlinks,
  });
  const profiles = await loadCapabilityProfiles(
    options.targets.length > 0 ? options.targets : ["codex", "claude-code", "cursor"],
  );
  const findings = [...inventory.findings];

  for (const skill of inventory.skills.map(hydrateFrontmatter)) {
    for (const profile of profiles) {
      findings.push(...evaluateCompatibility(skill, profile));
    }
  }

  return {
    schema_version: 1,
    targets: profiles.map(({ id, version, docsUrl }) => ({ id, version, docsUrl })),
    skills: inventory.skills.map(({ name, rootPath, digest }) => ({ name, rootPath, digest })),
    findings,
    exitCode: findings.some(
      (finding) => finding.code.startsWith("compatibility.") && finding.status === "fail",
    )
      ? 1
      : 0,
  };
}

export function renderCompat(report: CompatibilityReport, format: string | undefined): string {
  const outputFormat: OutputFormat = parseOutputFormat(format);
  return formatOutput(report, outputFormat);
}
