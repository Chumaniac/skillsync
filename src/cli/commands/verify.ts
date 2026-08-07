import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import { evaluateCompatibility } from "../../domain/compatibility.js";
import { normalizeRelativePath } from "../../domain/digest.js";
import { parseSkillDocument } from "../../domain/frontmatter.js";
import { scanInventory, type Inventory, type ScanTarget } from "../../domain/inventory.js";
import { evaluatePolicy, type Policy } from "../../domain/policy.js";
import { toIssues, type Issue } from "../../domain/issue.js";
import { buildResolutions } from "../../domain/resolution.js";
import type { Finding } from "../../domain/result.js";
import type { Skill } from "../../domain/skill.js";
import { inspectProvenance } from "../../scanners/provenance.js";
import { inspectStructure } from "../../scanners/structure.js";
import { loadCapabilityProfiles } from "../../profiles/loader.js";

export type VerifyOptions = {
  paths: string[];
  targets: string[];
  followSymlinks?: boolean;
  policy?: Policy;
  policyPath?: string;
};

export type VerificationSummary = {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  unknown: number;
};

export type VerificationReport = {
  schema_version: 1;
  generated_at: string;
  targets: ScanTarget[];
  findings: Finding[];
  issues: Issue[];
  summary: VerificationSummary;
  exitCode: 0 | 1 | 2 | 3 | 4;
  reporting?: Policy["reporting"];
};

function targetForPath(path: string, index: number): ScanTarget {
  return {
    name: `verify-${index + 1}`,
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

function defaultPolicy(profileIds: string[]): Policy {
  return {
    schema_version: 1,
    fail_on: ["structure-error", "compatibility-loss:required-target"],
    targets: { required: profileIds },
    capabilities: {},
    sources: { allowed_hosts: [], require_resolved_commit: false },
    reporting: { sarif: true, include_local_paths: false },
  };
}

function summarize(findings: Finding[]): VerificationSummary {
  return findings.reduce<VerificationSummary>(
    (summary, finding) => {
      summary.total += 1;
      summary[finding.status] += 1;
      return summary;
    },
    { total: 0, pass: 0, warn: 0, fail: 0, unknown: 0 },
  );
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "Unknown policy error";
}

async function loadPolicyFile(path: string): Promise<{ value: unknown; error?: string }> {
  const policyPath = resolve(path);
  let content: string;
  try {
    content = await readFile(policyPath, "utf8");
  } catch (error: unknown) {
    return {
      value: null,
      error: `Cannot read policy file ${policyPath}: ${firstLine(error)}`,
    };
  }

  try {
    return { value: parseYaml(content, { uniqueKeys: true }) };
  } catch (error: unknown) {
    return {
      value: null,
      error: `Cannot parse policy file ${policyPath}: ${firstLine(error)}`,
    };
  }
}

export async function runVerification(options: VerifyOptions): Promise<VerificationReport> {
  const paths = options.paths.length > 0 ? options.paths : [".agents/skills", ".claude/skills", ".cursor/skills"];
  const profileValues = options.targets.length > 0 ? options.targets : ["codex", "claude-code", "cursor"];
  const targets = paths.map(targetForPath);
  const inventory: Inventory = await scanInventory(targets, {
    followSymlinks: options.followSymlinks,
  });
  const profiles = await loadCapabilityProfiles(profileValues);
  const findings = [...inventory.findings];

  for (const skill of inventory.skills) {
    findings.push(...inspectStructure(skill));

    const hydratedSkill = hydrateFrontmatter(skill);
    findings.push(...(await inspectProvenance(hydratedSkill)));
    for (const profile of profiles) {
      findings.push(...evaluateCompatibility(hydratedSkill, profile));
    }
  }

  let policyInput: unknown = options.policy ?? defaultPolicy(profiles.map((profile) => profile.id));
  let policyInputError: string | undefined;
  if (options.policyPath) {
    const loaded = await loadPolicyFile(options.policyPath);
    policyInput = loaded.value;
    policyInputError = loaded.error;
  }
  const policyResult = evaluatePolicy(findings, policyInput, policyInputError);
  const rootPath = targets.find((target) => target.scope === "explicit")?.path ?? resolve(".");
  const seenIssueIds = new Set<string>();
  const issues = toIssues(policyResult.findings)
    .map((issue) => ({ ...issue, resolutions: buildResolutions(issue, { rootPath }) }))
    .filter((issue) => {
      if (seenIssueIds.has(issue.id)) return false;
      seenIssueIds.add(issue.id);
      return true;
    });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    targets,
    findings: policyResult.findings,
    issues,
    summary: summarize(policyResult.findings),
    exitCode: policyResult.exitCode,
    reporting: policyResult.policy?.reporting ?? { sarif: true, include_local_paths: false },
  };
}
