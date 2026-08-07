import { createHash } from "node:crypto";

import { compareIssues } from "./baseline.js";
import type { Baseline, IssueComparison } from "./baseline.js";
import type { ActionPlan } from "./action-plan.js";
import type { Issue, IssueState } from "./issue.js";
import type { ApplyReceipt } from "./patch-application.js";

export type VerificationSnapshot = {
  issues: Issue[];
  exitCode: 0 | 1 | 2 | 3 | 4;
  rootDigest: string;
  verificationReportDigest: string;
};

export type EvidenceReport = {
  schema_version: 1;
  conclusion: "verified" | "not-verified";
  generatedAt: string;
  toolVersion: string;
  rootDigest: string;
  comparison: IssueComparison;
  issueStates: Array<{ id: string; before: IssueState | "absent"; after: IssueState | "absent" }>;
  planDigest?: string;
  applyReceiptDigest?: string;
  verificationReportDigest: string;
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

function receiptDigest(receipt: ApplyReceipt): string {
  return `sha256:${createHash("sha256").update(canonicalJson(receipt)).digest("hex")}`;
}

function issueStates(before: Issue[], after: Issue[]): EvidenceReport["issueStates"] {
  const beforeStates = new Map(before.map((issue) => [issue.id, issue.state]));
  const afterStates = new Map(after.map((issue) => [issue.id, issue.state]));
  const ids = new Set([...beforeStates.keys(), ...afterStates.keys()]);

  return [...ids]
    .sort(compareText)
    .map((id) => ({
      id,
      before: beforeStates.get(id) ?? "absent",
      after: afterStates.get(id) ?? "absent",
    }));
}

export function createEvidenceReport(input: {
  before: VerificationSnapshot;
  after: VerificationSnapshot;
  plan?: ActionPlan;
  receipt?: ApplyReceipt;
  baseline?: Baseline;
  toolVersion: string;
}): EvidenceReport {
  return {
    schema_version: 1,
    conclusion: input.after.exitCode === 0 ? "verified" : "not-verified",
    generatedAt: new Date().toISOString(),
    toolVersion: input.toolVersion,
    rootDigest: input.after.rootDigest,
    comparison: compareIssues(input.before.issues, input.after.issues, input.baseline),
    issueStates: issueStates(input.before.issues, input.after.issues),
    ...(input.plan === undefined ? {} : { planDigest: input.plan.planDigest }),
    ...(input.receipt === undefined ? {} : { applyReceiptDigest: receiptDigest(input.receipt) }),
    verificationReportDigest: input.after.verificationReportDigest,
  };
}
