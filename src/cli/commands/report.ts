import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { ActionPlan } from "../../domain/action-plan.js";
import type { Baseline } from "../../domain/baseline.js";
import { createEvidenceReport, type EvidenceReport, type VerificationSnapshot } from "../../domain/evidence-report.js";
import type { Issue } from "../../domain/issue.js";
import type { ApplyReceipt } from "../../domain/patch-application.js";
import type { VerificationReport } from "./verify.js";

export type ReportOptions = {
  beforePath: string;
  afterPath: string;
  planPath?: string;
  receiptPath?: string;
  toolVersion?: string;
};

export type ReportFormat = "markdown" | "json" | "sarif";

const ISSUE_ID_PATTERN = /^iss_[0-9a-f]{64}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const APPLY_RECEIPT_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "status",
  "planDigest",
  "changedPaths",
  "backupPath",
  "generatedAt",
  "appliedNotVerified",
  "nextCommand",
]);

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

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIssueId(value: unknown): value is string {
  return typeof value === "string" && ISSUE_ID_PATTERN.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_DIGEST_PATTERN.test(value);
}

function validSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return false;

  const normalizedSeparators = value.replaceAll("\\", "/");
  if (normalizedSeparators.startsWith("/") || /^[A-Za-z]:/.test(normalizedSeparators)) return false;

  const segments = normalizedSeparators.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validSafeRelativePaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validSafeRelativePath);
}

function validMode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0o000 && value <= 0o777;
}

function hasOnlyTopLevelFields(value: Record<string, unknown>, allowedFields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedFields.has(key));
}

function validExitCode(value: unknown): value is VerificationSnapshot["exitCode"] {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

function validTarget(value: unknown): boolean {
  return isObject(value) &&
    typeof value.name === "string" && value.name.length > 0 &&
    typeof value.path === "string" && value.path.length > 0 &&
    ["project", "user", "explicit"].includes(String(value.scope)) &&
    (value.profileId === undefined || (typeof value.profileId === "string" && value.profileId.length > 0));
}

function validFinding(value: unknown): boolean {
  return isObject(value) &&
    typeof value.level === "number" && Number.isInteger(value.level) && value.level >= 0 && value.level <= 4 &&
    ["info", "warn", "error", "critical"].includes(String(value.severity)) &&
    ["pass", "warn", "fail", "unknown"].includes(String(value.status)) &&
    typeof value.code === "string" && value.code.length > 0 &&
    typeof value.skill === "string" && value.skill.length > 0 &&
    (value.target === undefined || (typeof value.target === "string" && value.target.length > 0)) &&
    typeof value.message === "string" && value.message.length > 0 &&
    Array.isArray(value.evidence) && value.evidence.every((record) =>
      isObject(record) && Object.values(record).every((item) => typeof item === "string")) &&
    (value.remediation === undefined || (typeof value.remediation === "string" && value.remediation.length > 0));
}

function validSummary(value: unknown): boolean {
  return isObject(value) &&
    ["total", "pass", "warn", "fail", "unknown"].every((key) =>
      typeof value[key] === "number" && Number.isInteger(value[key]) && value[key] >= 0);
}

function validReporting(value: unknown): boolean {
  return isObject(value) &&
    hasOnlyTopLevelFields(value, new Set(["sarif", "include_local_paths"])) &&
    typeof value.sarif === "boolean" &&
    typeof value.include_local_paths === "boolean";
}

function validIdentity(value: unknown): boolean {
  return isObject(value) &&
    typeof value.code === "string" && value.code.length > 0 &&
    typeof value.skill === "string" && value.skill.length > 0 &&
    typeof value.evidenceKey === "string" &&
    (value.target === undefined || (typeof value.target === "string" && value.target.length > 0));
}

function validIssue(value: unknown): value is Issue {
  return isObject(value) &&
    validIssueId(value.id) &&
    ["open", "acknowledged", "resolved", "ignored", "regressed"].includes(String(value.state)) &&
    validIdentity(value.identity);
}

function validateVerificationReport(value: unknown): VerificationReport {
  if (!isObject(value) || value.schema_version !== 1 ||
    typeof value.generated_at !== "string" || value.generated_at.length === 0 ||
    !Array.isArray(value.targets) || value.targets.length === 0 || !value.targets.every(validTarget) ||
    !Array.isArray(value.findings) || !value.findings.every(validFinding) ||
    !Array.isArray(value.issues) || !validExitCode(value.exitCode) || !validSummary(value.summary)) {
    throw new Error("Invalid verification report.");
  }
  if (value.reporting !== undefined && !validReporting(value.reporting)) {
    throw new Error("Invalid verification report.");
  }
  if (!value.issues.every(validIssue)) {
    throw new Error("Invalid verification report.");
  }
  return value as unknown as VerificationReport;
}

async function readJson(path: string, label: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new Error(`Cannot read ${label}.`);
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Cannot parse ${label}.`);
  }
}

async function readVerificationReport(path: string): Promise<VerificationReport> {
  return validateVerificationReport(await readJson(path, "verification report"));
}

async function readPlan(path: string): Promise<ActionPlan> {
  const value = await readJson(path, "ActionPlan");
  if (!isObject(value) ||
    value.schema_version !== 1 ||
    typeof value.rootPath !== "string" || value.rootPath.length === 0 || !isAbsolute(value.rootPath) ||
    typeof value.generatedAt !== "string" || value.generatedAt.length === 0 ||
    !validDigest(value.planDigest) ||
    !Array.isArray(value.issueIds) || !value.issueIds.every(validIssueId) ||
    !Array.isArray(value.changes) || !value.changes.every((change) =>
      isObject(change) &&
      validSafeRelativePath(change.path) &&
      typeof change.before === "string" &&
      typeof change.after === "string" &&
      (change.safety === "safe" || change.safety === "review-required") &&
      (change.modeBefore === undefined || validMode(change.modeBefore)) &&
      (change.modeAfter === undefined || validMode(change.modeAfter))) ||
    !Array.isArray(value.manualSteps) || !value.manualSteps.every((step) =>
      isObject(step) &&
      validIssueId(step.issueId) &&
      typeof step.title === "string" && step.title.length > 0 &&
      Array.isArray(step.steps) && step.steps.every((item) => typeof item === "string"))) {
    throw new Error("Invalid ActionPlan.");
  }
  return value as unknown as ActionPlan;
}

async function readReceipt(path: string): Promise<ApplyReceipt> {
  const value = await readJson(path, "ApplyReceipt");
  const status = isObject(value) ? value.status : undefined;
  const planDigest = isObject(value) ? value.planDigest : undefined;
  const changedPaths = isObject(value) ? value.changedPaths : undefined;
  const backupPath = isObject(value) ? value.backupPath : undefined;
  const generatedAt = isObject(value) ? value.generatedAt : undefined;
  if (!isObject(value) ||
    !hasOnlyTopLevelFields(value, APPLY_RECEIPT_TOP_LEVEL_FIELDS) ||
    value.schema_version !== 1 ||
    (status !== "applied" && status !== "restored") ||
    !validDigest(planDigest) ||
    !validSafeRelativePaths(changedPaths) ||
    typeof generatedAt !== "string" || generatedAt.length === 0 ||
    (backupPath !== undefined && typeof backupPath !== "string") ||
    (value.appliedNotVerified !== undefined && value.appliedNotVerified !== true) ||
    (value.nextCommand !== undefined && value.nextCommand !== "skillsync verify")) {
    throw new Error("Invalid ApplyReceipt.");
  }
  return {
    schema_version: 1,
    status,
    planDigest,
    changedPaths: [...changedPaths],
    ...(backupPath === undefined ? {} : { backupPath }),
    generatedAt,
  };
}

function safeIssue(issue: Issue): { id: string; state: string; identity: Issue["identity"] } {
  return { id: issue.id, state: issue.state, identity: issue.identity };
}

function snapshotFrom(report: VerificationReport, includeResolved: boolean): VerificationSnapshot {
  const issues = report.issues.filter((issue) => includeResolved || issue.state !== "resolved");
  const targetIdentity = report.targets.map((target) => ({
    name: target.name,
    scope: target.scope,
    ...(target.profileId === undefined ? {} : { profileId: target.profileId }),
  })).sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
  return {
    issues,
    exitCode: report.exitCode,
    rootDigest: digest({ targets: targetIdentity, issues: issues.map(safeIssue).sort((left, right) => compareText(left.id, right.id)) }),
    verificationReportDigest: digest(report),
  };
}

function resolvedIssueBaseline(report: VerificationReport, rootDigest: string): Baseline | undefined {
  const issues = report.issues
    .filter((issue) => issue.state === "resolved")
    .map((issue) => ({ id: issue.id, state: "resolved" as const }));
  if (issues.length === 0) return undefined;
  return {
    schema_version: 1,
    rootDigest,
    skills: [],
    issues,
    profileFingerprint: "sha256:report-history",
    policyFingerprint: "sha256:report-history",
  };
}

export async function runReport(options: ReportOptions): Promise<EvidenceReport> {
  const beforeReport = await readVerificationReport(options.beforePath);
  const afterReport = await readVerificationReport(options.afterPath);
  const before = snapshotFrom(beforeReport, false);
  const after = snapshotFrom(afterReport, false);
  const plan = options.planPath === undefined ? undefined : await readPlan(options.planPath);
  const receipt = options.receiptPath === undefined ? undefined : await readReceipt(options.receiptPath);

  return createEvidenceReport({
    before,
    after,
    ...(plan === undefined ? {} : { plan }),
    ...(receipt === undefined ? {} : { receipt }),
    ...(resolvedIssueBaseline(beforeReport, before.rootDigest) === undefined
      ? {}
      : { baseline: resolvedIssueBaseline(beforeReport, before.rootDigest) }),
    toolVersion: options.toolVersion ?? "0.1.0",
  });
}

function list(ids: string[]): string {
  return ids.length === 0 ? "none" : ids.join(", ");
}

function renderMarkdown(report: EvidenceReport): string {
  const lines = [
    "# SkillSync verification evidence report",
    "",
    `Conclusion: ${report.conclusion}`,
    "",
    "## Issue comparison",
    "",
    `- New (${report.comparison.newIds.length}): ${list(report.comparison.newIds)}`,
    `- Ongoing (${report.comparison.ongoingIds.length}): ${list(report.comparison.ongoingIds)}`,
    `- Resolved (${report.comparison.resolvedIds.length}): ${list(report.comparison.resolvedIds)}`,
    `- Regressed (${report.comparison.regressedIds.length}): ${list(report.comparison.regressedIds)}`,
    "",
    "## Issue states",
    "",
    ...(report.issueStates.length === 0
      ? ["- none"]
      : report.issueStates.map((issue) => `- ${issue.id}: ${issue.before} -> ${issue.after}`)),
    "",
    `Plan digest: ${report.planDigest ?? "none"}`,
    `Apply receipt digest: ${report.applyReceiptDigest ?? "none"}`,
    `Verification report digest: ${report.verificationReportDigest}`,
  ];
  return `${lines.join("\n")}\n`;
}

function renderSarif(report: EvidenceReport): string {
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "skillsync",
          version: report.toolVersion,
          rules: [{ id: "skillsync.issue-state", shortDescription: { text: "SkillSync Issue state transition" } }],
        },
      },
      results: report.issueStates.map((issue) => ({
        ruleId: "skillsync.issue-state",
        level: report.conclusion === "verified" ? "note" : "warning",
        message: { text: `Issue ${issue.id}: ${issue.before} -> ${issue.after}` },
        properties: { issueId: issue.id, before: issue.before, after: issue.after },
      })),
      properties: {
        conclusion: report.conclusion,
        rootDigest: report.rootDigest,
        verificationReportDigest: report.verificationReportDigest,
      },
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

export function renderReport(report: EvidenceReport, format: ReportFormat): string {
  if (format === "markdown") return renderMarkdown(report);
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "sarif") return renderSarif(report);
  throw new Error(`Unsupported report output format: ${String(format)}`);
}
