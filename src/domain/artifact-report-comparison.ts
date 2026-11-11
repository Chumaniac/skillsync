import type { ArtifactComparison, ArtifactReport } from "./artifact-report.js";

// Preserve the existing public import path while the report contract has one owner.
export { artifactComparisonSchema, artifactSetHash, parseArtifactReport } from "./artifact-report.js";
export type { ArtifactComparison } from "./artifact-report.js";

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
