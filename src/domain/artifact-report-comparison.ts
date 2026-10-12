import { createHash } from "node:crypto";
import { z } from "zod";
import type { ArtifactReport } from "../cli/commands/artifacts.js";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().min(0).max(100_000);
const status = z.enum(["passed", "failed"]);
const checkStatus = z.enum(["passed", "failed", "unknown"]);
const path = z.string().min(1).max(1024).refine(value => !value.startsWith("/") &&
  !/^[A-Za-z]:/.test(value) && !/[\\\p{Cc}]/u.test(value) &&
  value.split("/").every(part => part && part !== "." && part !== ".."));
const field = z.string().min(1).max(128);
const side = z.object({ path, key: z.union([field, z.array(field).min(2).max(4)]), value: field }).strict();
const change = z.enum(["improved", "regressed", "changed", "unchanged"]);
export const artifactComparisonSchema = z.object({
  schema: z.literal("skillsync.artifact-comparison/v1"), status: z.enum(["compared", "unavailable"]),
  reason: z.enum(["contract-changed", "incomplete-evidence", "check-declarations-changed"]).optional(),
  baseline_report_sha256: sha, baseline_status: status, current_status: status,
  baseline_artifact_set_sha256: sha.optional(), current_artifact_set_sha256: sha.optional(),
  findings: z.object({ added: count, ongoing: count, resolved: count }).strict().optional(),
  checks: z.array(z.object({ index: z.number().int().min(0).max(127), before: checkStatus,
    after: checkStatus, change }).strict()).max(128).optional(),
}).strict();
export type ArtifactComparison = z.infer<typeof artifactComparisonSchema>;

const summary = z.object({ type: z.literal("keyed_integer_sum_equals"), source: side, target: side,
  status: checkStatus, sourceKeys: count.optional(), targetKeys: count.optional(), missingKeys: count.optional(),
  unexpectedKeys: count.optional(), valueMismatches: count.optional(),
  recordEvidence: z.object({ total: count, truncated: z.boolean(), items: z.array(z.object({
    kind: z.enum(["value_mismatch", "missing", "unexpected"]), sourceRows: z.array(count.min(1)).max(8),
    targetRows: z.array(count.min(1)).max(8), sourceRowsTruncated: z.boolean(), targetRowsTruncated: z.boolean(),
  }).strict()).max(64) }).strict().optional(),
}).strict().superRefine((item, context) => {
  const values = [item.sourceKeys, item.targetKeys, item.missingKeys, item.unexpectedKeys, item.valueMismatches];
  if (item.status === "unknown" ? values.some(value => value !== undefined) : values.some(value => value === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "incomplete reconciliation counts" });
  }
  if (item.status === "passed" && [item.missingKeys, item.unexpectedKeys, item.valueMismatches].some(value => value !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent reconciliation status" });
  }
});

const reportSchema = z.object({ schema: z.literal("skillsync.artifacts-report/v1"), status,
  exitCode: z.number().int().min(0).max(2), evidence: z.literal("physical-files"), execution: z.literal("not-run"),
  provenance: z.literal("not-authenticated"), receipt_binding: z.enum(["verified", "not-provided", "failed"]),
  contract_sha256: sha.optional(), artifact_set_sha256: sha.optional(),
  files: z.array(z.object({ path, bytes: z.number().int().min(0).max(16 * 1024 * 1024),
    sha256: sha, rows: count.optional() }).strict()).max(10_000),
  findings: z.array(z.object({ code: z.string().min(1).max(128).regex(/^[a-z][a-z0-9.-]*$/),
    path: path.optional(), field: z.union([field, z.array(field).min(1).max(4)]).optional(),
    row: count.min(1).optional(), message: z.string().max(4096).optional(),
  }).strict()).max(256), reconciliations: z.array(summary).max(128).optional(),
  comparison: artifactComparisonSchema.optional(),
}).strict().superRefine((report, context) => {
  if (new Set(report.files.map(file => file.path)).size !== report.files.length ||
    report.files.reduce((total, file) => total + file.bytes, 0) > 64 * 1024 * 1024 ||
    (report.artifact_set_sha256 !== undefined && report.artifact_set_sha256 !== artifactSetHash(report.files)) ||
    (report.status === "passed" && (report.exitCode !== 0 || report.findings.length ||
      report.reconciliations?.some(item => item.status !== "passed"))) ||
    (report.status === "failed" && report.exitCode === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent artifact report" });
  }
});

export function artifactSetHash(files: ArtifactReport["files"]): string {
  const digest = createHash("sha256");
  for (const file of [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(file.bytes));
    digest.update(file.path); digest.update(Buffer.from([0])); digest.update(size); digest.update(file.sha256);
  }
  return digest.digest("hex");
}

export function parseArtifactReport(value: unknown): ArtifactReport {
  return reportSchema.parse(value);
}

/** Caller-supplied history is not authenticated; never forward its messages or record positions. */
export function compareArtifactReports(before: ArtifactReport, after: ArtifactReport, digest: string): ArtifactComparison {
  const result: ArtifactComparison = { schema: "skillsync.artifact-comparison/v1", status: "unavailable",
    baseline_report_sha256: digest, baseline_status: before.status, current_status: after.status,
    ...(before.artifact_set_sha256 ? { baseline_artifact_set_sha256: before.artifact_set_sha256 } : {}),
    ...(after.artifact_set_sha256 ? { current_artifact_set_sha256: after.artifact_set_sha256 } : {}) };
  if (!before.contract_sha256 || before.contract_sha256 !== after.contract_sha256) return { ...result, reason: "contract-changed" };
  const left = before.reconciliations ?? [], right = after.reconciliations ?? [];
  // A saturated finding list may have omitted defects; do not call them resolved.
  if ([before, after].some(report => !report.artifact_set_sha256 || report.receipt_binding === "failed" ||
    report.findings.length >= 256 || report.comparison?.status === "unavailable" ||
    report.reconciliations?.some(item => item.status === "unknown"))) {
    return { ...result, reason: "incomplete-evidence" };
  }
  const identity = (item: (typeof left)[number]) => JSON.stringify([item.type, item.source, item.target]);
  if (left.length !== right.length || left.some((item, index) => identity(item) !== identity(right[index]))) {
    return { ...result, reason: "check-declarations-changed" };
  }
  const findings = (report: ArtifactReport) => new Set(report.findings.map(item => JSON.stringify([item.code, item.path, item.field])));
  const a = findings(before), b = findings(after);
  result.status = "compared";
  result.findings = { added: [...b].filter(key => !a.has(key)).length,
    ongoing: [...b].filter(key => a.has(key)).length, resolved: [...a].filter(key => !b.has(key)).length };
  result.checks = left.map((item, index) => {
    const current = right[index];
    const x = [item.missingKeys!, item.unexpectedKeys!, item.valueMismatches!];
    const y = [current.missingKeys!, current.unexpectedKeys!, current.valueMismatches!];
    const equal = x.every((value, i) => value === y[i]);
    const kind = item.status !== current.status ? current.status === "passed" ? "improved" : "regressed" :
      equal ? "unchanged" : y.every((value, i) => value <= x[i]) ? "improved" :
        y.every((value, i) => value >= x[i]) ? "regressed" : "changed";
    return { index, before: item.status, after: current.status, change: kind };
  });
  return result;
}
