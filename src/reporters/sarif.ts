import type { Finding } from "../domain/result.js";
import { issueIdForFinding } from "../domain/issue.js";
import type { VerificationReport } from "../cli/commands/verify.js";
import { isAbsoluteLocalPath, isRedactedLocalPath, redactLocalPaths } from "./local-paths.js";

type SarifRule = {
  id: string;
  shortDescription: { text: string };
  help?: { text: string };
};

function resultLevel(finding: Finding): "note" | "warning" | "error" {
  if (finding.status === "pass" || finding.severity === "info") {
    return "note";
  }
  if (finding.status === "fail" || finding.severity === "error" || finding.severity === "critical") {
    return "error";
  }
  return "warning";
}

function locationFor(finding: Finding, includeLocalPaths: boolean): Array<{
  physicalLocation: { artifactLocation: { uri: string } };
}> {
  const pathEvidence = finding.evidence.find((evidence) => typeof evidence.path === "string");
  return pathEvidence?.path &&
    !isRedactedLocalPath(pathEvidence.path) &&
    (includeLocalPaths || !isAbsoluteLocalPath(pathEvidence.path))
    ? [{ physicalLocation: { artifactLocation: { uri: pathEvidence.path } } }]
    : [];
}

export function renderSarif(report: VerificationReport): string {
  const includeLocalPaths = report.reporting?.include_local_paths === true;
  const safeFindings = report.findings.map((finding) => redactLocalPaths(finding, {
    includeLocalPaths,
  }));
  const issueIds = new Set((report.issues ?? []).map((issue) => issue.id));
  const ruleMap = new Map<string, SarifRule>();
  for (const finding of safeFindings) {
    if (!ruleMap.has(finding.code)) {
      ruleMap.set(finding.code, {
        id: finding.code,
        shortDescription: { text: finding.message },
        ...(finding.remediation ? { help: { text: finding.remediation } } : {}),
      });
    }
  }

  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "skillsync",
            version: "0.1.0",
            rules: [...ruleMap.values()],
          },
        },
        results: safeFindings.map((finding, index) => {
          const originalFinding = report.findings[index] ?? finding;
          const issueId = issueIdForFinding(originalFinding);
          return {
            ruleId: finding.code,
            level: resultLevel(finding),
            message: { text: finding.message },
            locations: locationFor(finding, includeLocalPaths),
            properties: {
              skill: finding.skill,
              ...(finding.target ? { target: finding.target } : {}),
              status: finding.status,
              ...(finding.remediation ? { remediation: finding.remediation } : {}),
              ...(issueIds.has(issueId) ? { issueId } : {}),
            },
          };
        }),
      },
    ],
  };

  return `${JSON.stringify(sarif, null, 2)}\n`;
}
