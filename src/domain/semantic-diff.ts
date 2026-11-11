import { normalizeRelativePath } from "./digest.js";
import type { Skill } from "./skill.js";

export type SemanticChangeKind =
  | "routing-change"
  | "capability-change"
  | "compatibility-loss"
  | "provenance-change"
  | "resource-change"
  | "policy-change";

export type SemanticChange = {
  kind: SemanticChangeKind;
  skill: string;
  summary: string;
  evidence: Array<Record<string, string>>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function evidenceValue(value: unknown): string {
  const serialized = stableStringify(value);
  return serialized === undefined ? "undefined" : serialized;
}

function change(
  skill: Skill,
  kind: SemanticChangeKind,
  summary: string,
  evidence: Array<Record<string, string>>,
): SemanticChange {
  return { kind, skill: skill.name, summary, evidence };
}

function normalizedFilePaths(skill: Skill): string[] {
  return skill.files.map((file) => {
    try {
      return normalizeRelativePath(file.relativePath);
    } catch {
      return file.relativePath;
    }
  });
}

function pathsWithout(paths: string[], predicate: (path: string) => boolean): string[] {
  return paths.filter((path) => !predicate(path)).sort();
}

function setDifference(left: string[], right: string[]): { added: string[]; removed: string[] } {
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  return {
    added: left.filter((path) => !rightSet.has(path)).sort(),
    removed: right.filter((path) => !leftSet.has(path)).sort(),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compatibilityLosses(before: unknown, after: unknown): Array<[string, unknown, unknown]> {
  if (!isObject(before) || !isObject(after)) {
    return [];
  }
  const targets = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...targets]
    .sort()
    .filter((target) => {
      const beforeStatus = before[target];
      const afterStatus = after[target];
      return (
        (beforeStatus === "pass" || beforeStatus === "warn") &&
        (afterStatus === "fail" || afterStatus === "unknown")
      );
    })
    .map((target) => [target, before[target], after[target]]);
}

export function compareSkills(before: Skill, after: Skill): SemanticChange[] {
  const changes: SemanticChange[] = [];

  for (const field of ["name", "description"] as const) {
    const beforeValue = before.frontmatter[field];
    const afterValue = after.frontmatter[field];
    if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
      changes.push(
        change(
          after,
          "routing-change",
          `Frontmatter ${field} changed and may alter Skill routing.`,
          [{ field, before: evidenceValue(beforeValue), after: evidenceValue(afterValue) }],
        ),
      );
    }
  }

  for (const field of ["allowed-tools", "hooks", "context"] as const) {
    const beforeValue = before.frontmatter[field];
    const afterValue = after.frontmatter[field];
    if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
      changes.push(
        change(
          after,
          "capability-change",
          `Frontmatter ${field} changed the Skill capability surface.`,
          [{ field, before: evidenceValue(beforeValue), after: evidenceValue(afterValue) }],
        ),
      );
    }
  }

  const beforePaths = normalizedFilePaths(before);
  const afterPaths = normalizedFilePaths(after);
  const scriptDiff = setDifference(
    pathsWithout(beforePaths, (path) => !path.startsWith("scripts/")),
    pathsWithout(afterPaths, (path) => !path.startsWith("scripts/")),
  );
  if (scriptDiff.added.length > 0 || scriptDiff.removed.length > 0) {
    changes.push(
      change(after, "capability-change", "Bundled script capability changed.", [
        { added: scriptDiff.added.join(","), removed: scriptDiff.removed.join(",") },
      ]),
    );
  }

  const beforeResources = pathsWithout(
    beforePaths,
    (path) => path === "SKILL.md" || path.startsWith("scripts/"),
  );
  const afterResources = pathsWithout(
    afterPaths,
    (path) => path === "SKILL.md" || path.startsWith("scripts/"),
  );
  const resourceDiff = setDifference(afterResources, beforeResources);
  if (resourceDiff.added.length > 0 || resourceDiff.removed.length > 0) {
    changes.push(
      change(after, "resource-change", "Bundled resource inventory changed.", [
        { added: resourceDiff.added.join(","), removed: resourceDiff.removed.join(",") },
      ]),
    );
  }

  if (stableStringify(before.source) !== stableStringify(after.source) || before.digest !== after.digest) {
    changes.push(
      change(after, "provenance-change", "Skill source identity or content digest changed.", [
        { before_source: evidenceValue(before.source), after_source: evidenceValue(after.source), before_digest: before.digest, after_digest: after.digest },
      ]),
    );
  }

  for (const [target, beforeStatus, afterStatus] of compatibilityLosses(
    before.frontmatter.compatibility,
    after.frontmatter.compatibility,
  )) {
    changes.push(
      change(after, "compatibility-loss", `Compatibility for ${target} regressed.`, [
        { target, before: String(beforeStatus), after: String(afterStatus) },
      ]),
    );
  }

  if (stableStringify(before.frontmatter.policy) !== stableStringify(after.frontmatter.policy)) {
    changes.push(
      change(after, "policy-change", "Skill policy metadata changed.", [
        { before: evidenceValue(before.frontmatter.policy), after: evidenceValue(after.frontmatter.policy) },
      ]),
    );
  }

  return changes;
}
