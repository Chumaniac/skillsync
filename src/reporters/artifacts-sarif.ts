import { createHash } from "node:crypto";
import type { ArtifactReport } from "../domain/artifact-report.js";
import { VERSION } from "../version.js";
import { isAbsoluteLocalPath, isRedactedLocalPath } from "./local-paths.js";

function relativeUri(path: string | undefined): string | undefined {
  if (!path || path.length > 1024 || isAbsoluteLocalPath(path) || isRedactedLocalPath(path) ||
    /[\\:\p{Cc}\p{Cf}]/u.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) return undefined;
  try { return path.split("/").map(part => encodeURIComponent(part)).join("/"); }
  catch { return undefined; }
}

/** Export inspector metadata only: no raw values, field names, free-form messages or local roots. */
export function renderArtifactsSarif(report: ArtifactReport): string {
  const codes = [...new Set(report.findings.map(finding => finding.code))];
  const results = report.findings.map(finding => {
    const uri = relativeUri(finding.path);
    // CSV findings count logical data records, not physical lines (quoted records can span lines).
    const dataRecord = Number.isSafeInteger(finding.row) && finding.row! > 0 ? finding.row : undefined;
    const identity = JSON.stringify([finding.code, uri ?? null, dataRecord ?? null]);
    return {
      ruleId: finding.code,
      level: "error",
      message: { text: `Artifact check failed: ${finding.code}. Review the original files and contract.` },
      locations: uri ? [{ physicalLocation: { artifactLocation: { uri } } }] : [],
      partialFingerprints: { "skillsyncArtifacts/v1": createHash("sha256").update(identity).digest("hex") },
      ...(dataRecord !== undefined ? { properties: { dataRecord } } : {}),
    };
  });
  return JSON.stringify({
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "skillsync-artifacts", version: VERSION,
        rules: codes.map(code => ({ id: code, shortDescription: { text: `Artifact check: ${code}` } })) } },
      invocations: [{ executionSuccessful: report.exitCode !== 2 }],
      results,
      properties: { schema: report.schema, status: report.status, evidence: report.evidence,
        execution: report.execution, provenance: report.provenance, receipt_binding: report.receipt_binding },
    }],
  }, null, 2) + "\n";
}
