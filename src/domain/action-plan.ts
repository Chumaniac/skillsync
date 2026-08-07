import { createHash } from "node:crypto";

import { normalizeRelativePath } from "./digest.js";
import { buildResolutions } from "./resolution.js";
import type { PatchChange } from "./resolution.js";
import type { Issue } from "./issue.js";

export type ActionPlan = {
  schema_version: 1;
  rootPath: string;
  generatedAt: string;
  issueIds: string[];
  changes: PatchChange[];
  manualSteps: Array<{ issueId: string; title: string; steps: string[] }>;
  planDigest: string;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  return `{${Object.keys(value as Record<string, unknown>)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function validatePatchPath(path: string): string {
  const normalizedSeparators = path.replaceAll("\\", "/");
  if (normalizedSeparators.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Unsafe patch path: ${path}`);
  }
  return normalizeRelativePath(normalizedSeparators);
}

export function sortPatchChanges(changes: PatchChange[]): PatchChange[] {
  return [...changes].sort((left, right) =>
    compareText(left.path, right.path) ||
    compareText(left.before, right.before) ||
    compareText(left.after, right.after) ||
    (left.modeBefore ?? -1) - (right.modeBefore ?? -1) ||
    (left.modeAfter ?? -1) - (right.modeAfter ?? -1) ||
    compareText(left.safety, right.safety),
  );
}

export function planDigest(plan: Omit<ActionPlan, "planDigest" | "generatedAt">): string {
  return `sha256:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`;
}

export function createActionPlan(input: {
  rootPath: string;
  issues: Issue[];
  generatedAt?: string;
}): ActionPlan {
  if (input.issues.length === 0) {
    throw new Error("ActionPlan requires at least one issue.");
  }

  const issueIds = input.issues.map((issue) => issue.id).sort(compareText);
  const changes: PatchChange[] = [];
  const manualSteps: ActionPlan["manualSteps"] = [];

  for (const issue of input.issues) {
    for (const resolution of buildResolutions(issue, { rootPath: input.rootPath })) {
      if (resolution.kind === "patch") {
        for (const change of resolution.changes) {
          changes.push({ ...change, path: validatePatchPath(change.path), safety: resolution.safety });
        }
      } else if (resolution.kind === "manual") {
        manualSteps.push({ issueId: issue.id, title: resolution.title, steps: [...resolution.steps] });
      }
    }
  }

  const sortedChanges = sortPatchChanges(changes);
  manualSteps.sort((left, right) => compareText(left.issueId, right.issueId) || compareText(left.title, right.title));

  const digestInput = {
    schema_version: 1 as const,
    rootPath: input.rootPath,
    issueIds,
    changes: sortedChanges,
    manualSteps,
  };
  return {
    ...digestInput,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    planDigest: planDigest(digestInput),
  };
}
