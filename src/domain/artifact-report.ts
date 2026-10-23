import { createHash } from "node:crypto";
import { z } from "zod";
import { artifactDeclarationsSchema } from "./artifact-contract.js";
import type { ArtifactDeclarations } from "./artifact-contract.js";
import type { ArtifactFinding } from "./artifact-content.js";
import type { ReconciliationSummary } from "./artifact-reconciliation.js";

export type ArtifactReport = {
  schema: "skillsync.artifacts-report/v1"; status: "passed" | "failed"; exitCode: number;
  evidence: "physical-files"; execution: "not-run"; provenance: "not-authenticated";
  receipt_binding: "verified" | "not-provided" | "failed";
  contract_sha256?: string; artifact_set_sha256?: string;
  files: Array<{ path: string; bytes: number; sha256: string; rows?: number }>;
  findings: ArtifactFinding[];
  reconciliations?: ReconciliationSummary[];
  declarations?: ArtifactDeclarations;
  comparison?: ArtifactComparison;
};

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
    path: path.optional(), field: z.union([field, z.array(field).min(1).max(8)]).optional(),
    row: count.min(1).optional(), message: z.string().max(4096).optional(),
    reference: z.object({ path, field, row: count.min(1),
      matches: z.array(z.object({ source: field, target: field }).strict()).min(1).max(8),
    }).strict().optional(),
  }).strict()).max(256), reconciliations: z.array(summary).max(128).optional(),
  comparison: artifactComparisonSchema.optional(),
  declarations: artifactDeclarationsSchema.optional(),
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
