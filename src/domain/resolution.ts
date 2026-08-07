import { stringify } from "yaml";

import { normalizeRelativePath } from "./digest.js";
import { parseSkillDocument } from "./frontmatter.js";
import type { Issue } from "./issue.js";
import type { Skill } from "./skill.js";

export type PatchChange = {
  path: string;
  before: string;
  after: string;
  safety: "safe" | "review-required";
  modeBefore?: number;
  modeAfter?: number;
};

export type Resolution =
  | { kind: "manual"; title: string; steps: string[]; safety: "review-required" }
  | { kind: "patch"; title: string; safety: "safe" | "review-required"; changes: PatchChange[] }
  | { kind: "ignore"; title: string; reasonRequired: true };

type ResolutionContext = { rootPath: string; skill?: Skill };

function normalizePatchPath(path: string): string {
  const normalizedSeparators = path.replaceAll("\\", "/");
  if (normalizedSeparators.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe patch path: ${path}`);
  }
  return normalizeRelativePath(normalizedSeparators);
}

function manualResolution(issue: Issue): Resolution {
  const remediation = issue.finding.remediation ?? issue.explanation.impact;
  return {
    kind: "manual",
    title: `Manually resolve ${issue.finding.code}`,
    safety: "review-required",
    steps: [
      remediation,
      `Verify that ${issue.finding.code} no longer appears in the next SkillSync verification.`,
    ],
  };
}

function ignoreResolution(issue: Issue): Resolution {
  return {
    kind: "ignore",
    title: `Ignore ${issue.finding.code}`,
    reasonRequired: true,
  };
}

function scriptModePatch(issue: Issue): Resolution | undefined {
  const evidence = issue.finding.evidence.find(
    (item) => typeof item.path === "string" && typeof item.mode === "string" && /^0[0-7]{3}$/.test(item.mode),
  );
  if (!evidence?.path || !evidence.mode) return undefined;

  const modeBefore = Number.parseInt(evidence.mode, 8);
  const modeAfter = modeBefore & ~0o022;
  const path = normalizePatchPath(evidence.path);
  return {
    kind: "patch",
    title: `Remove group/world write permissions from ${path}`,
    safety: "safe",
    changes: [{ path, before: "", after: "", safety: "safe", modeBefore, modeAfter }],
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function frontmatterFormatPatch(context: ResolutionContext): Resolution | undefined {
  const skill = context.skill;
  const skillMd = skill?.files.find((file) => normalizePatchPath(file.relativePath) === "SKILL.md");
  if (!skill || !skillMd) return undefined;

  const source = skillMd.content.toString("utf8");
  const parsed = parseSkillDocument(source);
  if (!parsed.ok || JSON.stringify(canonicalValue(parsed.value.frontmatter)) !== JSON.stringify(canonicalValue(skill.frontmatter))) {
    return undefined;
  }

  const before = source.slice(parsed.value.sourceRange.start, parsed.value.sourceRange.end);
  const after = `---\n${stringify(canonicalValue(parsed.value.frontmatter))}---\n`;
  if (before === after) return undefined;

  return {
    kind: "patch",
    title: "Normalize SKILL.md frontmatter formatting",
    safety: "safe",
    changes: [{ path: "SKILL.md", before, after, safety: "safe" }],
  };
}

export function buildResolutions(issue: Issue, context: ResolutionContext): Resolution[] {
  let primary: Resolution | undefined;
  if (issue.finding.code === "structure.invalid-script-mode") {
    primary = scriptModePatch(issue);
  } else if (issue.finding.code === "structure.frontmatter-format") {
    primary = frontmatterFormatPatch(context);
  }

  return [primary ?? manualResolution(issue), ignoreResolution(issue)];
}
