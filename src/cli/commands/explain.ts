import type { Issue } from "../../domain/issue.js";
import type { Resolution } from "../../domain/resolution.js";
import { runVerification } from "./verify.js";

export type ExplainOptions = {
  issueId: string;
  paths: string[];
  targets: string[];
  policyPath?: string;
};

export class IssueCommandError extends Error {
  readonly exitCode = 2 as const;
}

function firstResolutionLabel(resolution: Resolution | undefined): string {
  if (!resolution) return "No resolution is available.";
  if (resolution.kind === "patch") {
    return `${resolution.title} (${resolution.safety})`;
  }
  return `${resolution.title} (${resolution.kind})`;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export async function runExplain(options: ExplainOptions): Promise<Issue> {
  const report = await runVerification({
    paths: options.paths,
    targets: options.targets,
    policyPath: options.policyPath,
  });
  const issue = report.issues.find((candidate) => candidate.id === options.issueId);
  if (!issue) {
    throw new IssueCommandError(`issue.not-found: ${options.issueId}`);
  }
  return issue;
}

export function renderExplain(issue: Issue, format: string | undefined = "text"): string {
  if (format === "json") {
    return `${JSON.stringify(issue, null, 2)}\n`;
  }
  if (format !== "text") {
    throw new Error(`Unsupported explain output format: ${format}`);
  }

  const target = issue.identity.target ? ` / ${issue.identity.target}` : "";
  const location = issue.location && !isAbsolutePath(issue.location.path)
    ? `${issue.location.path}${issue.location.line === undefined ? "" : `:${issue.location.line}`}`
    : "unavailable";
  const firstResolution = issue.resolutions[0];
  const manualSteps = issue.resolutions.filter(
    (resolution): resolution is Extract<Resolution, { kind: "manual" }> => resolution.kind === "manual",
  );
  const lines = [
    `Issue: ${issue.id}`,
    `State: ${issue.state}`,
    `Code: ${issue.identity.code}`,
    `Skill/target: ${issue.identity.skill}${target}`,
    `Cause: ${issue.explanation.cause}`,
    `Impact: ${issue.explanation.impact}`,
    `Location: ${location}`,
    `First resolution: ${firstResolutionLabel(firstResolution)}`,
    "Manual steps:",
  ];

  if (manualSteps.length === 0) {
    lines.push("- None.");
  } else {
    for (const resolution of manualSteps) {
      for (const step of resolution.steps) {
        lines.push(`- ${step}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
