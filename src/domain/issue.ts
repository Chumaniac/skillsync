import { createHash } from "node:crypto";

import type { Finding } from "./result.js";

import type { Resolution } from "./resolution.js";

export type IssueState = "open" | "acknowledged" | "resolved" | "ignored" | "regressed";

export type Issue = {
  id: string;
  state: IssueState;
  finding: Finding;
  identity: { code: string; skill: string; target?: string; evidenceKey: string };
  location?: { path: string; line?: number };
  explanation: { cause: string; impact: string; confidence: "deterministic" | "inferred" };
  resolutions: Resolution[];
};

const EXCLUDED_EVIDENCE_KEYS = new Set([
  "message",
  "remediation",
  "generated_at",
  "timestamp",
  "timestamps",
  "created_at",
  "updated_at",
]);

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function relativeToTargetRoot(value: string, targetRoot?: string): string | undefined {
  const path = normalizedPath(value);
  if (!isAbsolutePath(path)) return path;

  const normalizedRoot = targetRoot === undefined ? undefined : normalizedPath(targetRoot);
  const root = normalizedRoot === "/" ? "/" : normalizedRoot?.replace(/\/$/, "");
  if (!root) return undefined;
  if (root === "/") return path === "/" ? "." : path.slice(1);
  if (path === root) return ".";
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return undefined;
}

function isPathLikeKey(key: string | undefined): boolean {
  if (!key) return false;
  const normalizedKey = key.toLowerCase();
  return normalizedKey === "path" ||
    normalizedKey.endsWith("_path") ||
    normalizedKey === "location" ||
    normalizedKey === "file" ||
    normalizedKey === "directory";
}

function canonicalValue(value: unknown, targetRoot?: string, key?: string): unknown {
  if (typeof value === "string") {
    if (isPathLikeKey(key)) {
      return relativeToTargetRoot(value, targetRoot);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalValue(item, targetRoot, key))
      .filter((item): item is Exclude<typeof item, undefined> => item !== undefined);
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value).sort()) {
      if (EXCLUDED_EVIDENCE_KEYS.has(objectKey.toLowerCase())) continue;
      const item = canonicalValue((value as Record<string, unknown>)[objectKey], targetRoot, objectKey);
      if (item !== undefined) result[objectKey] = item;
    }
    return result;
  }

  return value;
}

function evidenceKeyForFinding(finding: Finding, targetRoot?: string): string {
  const canonicalEvidence = finding.evidence
    .map((record) => canonicalValue(record, targetRoot))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      const length = Math.min(leftJson.length, rightJson.length);
      for (let index = 0; index < length; index += 1) {
        const difference = leftJson.charCodeAt(index) - rightJson.charCodeAt(index);
        if (difference !== 0) return difference;
      }
      return leftJson.length - rightJson.length;
    });

  return JSON.stringify(canonicalEvidence);
}

function locationForFinding(finding: Finding, targetRoot?: string): Issue["location"] {
  const evidence = finding.evidence.find((record) => typeof record.path === "string");
  if (!evidence?.path) return undefined;

  const path = relativeToTargetRoot(evidence.path, targetRoot);
  if (!path) return undefined;

  const line = evidence.line && /^\d+$/.test(evidence.line) ? Number(evidence.line) : undefined;
  return line === undefined ? { path } : { path, line };
}

export function issueIdForFinding(finding: Finding, targetRoot?: string): string {
  const evidenceKey = evidenceKeyForFinding(finding, targetRoot);
  const material = [finding.code, finding.skill, finding.target ?? "", evidenceKey].join("\u0000");
  return `iss_${createHash("sha256").update(material).digest("hex")}`;
}

export function toIssue(finding: Finding, options: { targetRoot?: string }): Issue {
  const evidenceKey = evidenceKeyForFinding(finding, options.targetRoot);
  return {
    id: issueIdForFinding(finding, options.targetRoot),
    state: "open",
    finding,
    identity: {
      code: finding.code,
      skill: finding.skill,
      ...(finding.target === undefined ? {} : { target: finding.target }),
      evidenceKey,
    },
    location: locationForFinding(finding, options.targetRoot),
    explanation: {
      cause: finding.message,
      impact: finding.remediation ?? `Finding ${finding.code} requires attention.`,
      confidence: "deterministic",
    },
    resolutions: [],
  };
}

export function toIssues(findings: Finding[], options: { targetRoots?: Map<string, string> } = {}): Issue[] {
  return findings.map((finding) =>
    toIssue(finding, {
      targetRoot: finding.target === undefined ? undefined : options.targetRoots?.get(finding.target),
    }),
  );
}

const ALLOWED_TRANSITIONS: Record<IssueState, readonly IssueState[]> = {
  open: ["acknowledged", "resolved", "ignored"],
  acknowledged: ["resolved", "ignored"],
  resolved: ["regressed"],
  ignored: [],
  regressed: [],
};

export function transitionIssueState(issue: Issue, next: IssueState): Issue {
  if (!ALLOWED_TRANSITIONS[issue.state].includes(next)) {
    throw new Error(`Illegal issue state transition: ${issue.state} -> ${next}`);
  }
  return { ...issue, state: next };
}
