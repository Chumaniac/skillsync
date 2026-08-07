import type { VerificationReport } from "../cli/commands/verify.js";
import type { Issue } from "../domain/issue.js";
import { isAbsoluteLocalPath, isRedactedLocalPath, redactLocalPaths } from "./local-paths.js";

const severityOrder: Record<Issue["finding"]["severity"], number> = {
  critical: 0,
  error: 1,
  warn: 2,
  info: 3,
};

function resolutionKind(issue: Issue): "safe" | "manual" | "ignore" | "review-required" | undefined {
  const resolution = issue.resolutions[0];
  if (!resolution) return undefined;
  if (resolution.kind === "manual") return "manual";
  if (resolution.kind === "ignore") return "ignore";
  return resolution.safety === "safe" ? "safe" : "review-required";
}

function appendIssue(lines: string[], issue: Issue, includeLocalPaths: boolean): void {
  const finding = issue.finding;
  const target = finding.target ? ` target=${finding.target}` : "";
  lines.push(`issueId=${issue.id} status=${issue.state} code=${finding.code} Skill=${finding.skill}${target}`);
  lines.push(`  cause: ${issue.explanation.cause}`);
  lines.push(`  impact: ${issue.explanation.impact}`);
  if (issue.location && (includeLocalPaths || !isAbsoluteLocalPath(issue.location.path)) &&
    !isRedactedLocalPath(issue.location.path)) {
    const line = issue.location.line === undefined ? "" : `:${issue.location.line}`;
    lines.push(`  location: ${issue.location.path}${line}`);
  }

  const resolution = issue.resolutions[0];
  const kind = resolutionKind(issue);
  if (!resolution || !kind) return;
  lines.push(`  resolution: ${resolution.title} (${kind})`);
  if (resolution.kind === "manual") {
    for (const step of resolution.steps) {
      lines.push(`    - ${step}`);
    }
  }
}

export function renderText(report: VerificationReport): string {
  const includeLocalPaths = report.reporting?.include_local_paths === true;
  const lines = [
    `SkillSync verification: ${report.summary.total} findings`,
    `pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail} unknown=${report.summary.unknown}`,
  ];

  const issues = report.issues ?? [];
  if (issues.length > 0) {
    for (const issue of [...issues].sort(
      (left, right) => severityOrder[left.finding.severity] - severityOrder[right.finding.severity] ||
        left.id.localeCompare(right.id),
    )) {
      appendIssue(lines, redactLocalPaths(issue, { includeLocalPaths }), includeLocalPaths);
    }
  } else {
    for (const finding of report.findings.map((item) => redactLocalPaths(item, { includeLocalPaths }))) {
      const target = finding.target ? ` target=${finding.target}` : "";
      lines.push(`${finding.status.toUpperCase()} ${finding.code} ${finding.skill}${target}: ${finding.message}`);
      if (finding.remediation) {
        lines.push(`  remediation: ${finding.remediation}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
