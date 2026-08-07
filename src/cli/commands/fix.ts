import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createActionPlan, type ActionPlan } from "../../domain/action-plan.js";
import type { Issue } from "../../domain/issue.js";
import {
  ActionPlanApplyError,
  applyActionPlan,
  type ApplyReceipt,
} from "../../domain/patch-application.js";
import { runVerification } from "./verify.js";
import { IssueCommandError } from "./explain.js";

export type FixPlanOptions = {
  paths: string[];
  targets: string[];
  policyPath?: string;
  issueIds?: string[];
  output?: string;
};

export type FixApplyOptions = {
  planPath: string;
  yes: boolean;
  approveReviewRequired?: boolean;
  backup?: boolean;
};

function selectIssues(issues: Issue[], issueIds: string[] | undefined): Issue[] {
  if (!issueIds || issueIds.length === 0) return issues;

  const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
  const selected: Issue[] = [];
  for (const issueId of issueIds) {
    const issue = issuesById.get(issueId);
    if (!issue) {
      throw new IssueCommandError(`issue.not-found: ${issueId}`);
    }
    if (!selected.some((candidate) => candidate.id === issue.id)) {
      selected.push(issue);
    }
  }
  return selected;
}

function planFromJson(content: string, path: string): ActionPlan {
  try {
    return JSON.parse(content) as ActionPlan;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
    throw new Error(`Cannot parse ActionPlan ${path}: ${message}`);
  }
}

async function requireDirectSkillRoot(path: string): Promise<string> {
  const rootPath = resolve(path);
  try {
    if (!(await stat(rootPath)).isDirectory()) {
      throw new Error("not a directory");
    }
    const skillMd = await lstat(join(rootPath, "SKILL.md"));
    if (!skillMd.isFile() && !skillMd.isSymbolicLink()) {
      throw new Error("SKILL.md is not a file");
    }
  } catch {
    throw new Error("fix --plan requires --path to be a Skill root containing a direct SKILL.md.");
  }
  return rootPath;
}

export async function runFixPlan(options: FixPlanOptions): Promise<ActionPlan> {
  if (options.paths.length > 1) {
    throw new Error("fix --plan supports exactly one explicit --path; multi-root ActionPlans are not supported.");
  }
  if (options.paths.length === 0) {
    throw new Error("fix --plan requires exactly one explicit --path.");
  }
  const rootPath = await requireDirectSkillRoot(options.paths[0]);

  const report = await runVerification({
    paths: options.paths,
    targets: options.targets,
    policyPath: options.policyPath,
  });
  const issues = selectIssues(report.issues, options.issueIds);
  return createActionPlan({ rootPath, issues });
}

export async function writeFixPlan(plan: ActionPlan, outputPath: string): Promise<void> {
  const path = resolve(outputPath);
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function runFixApply(options: FixApplyOptions): Promise<ApplyReceipt> {
  const path = resolve(options.planPath);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
    throw new Error(`Cannot read ActionPlan ${path}: ${message}`);
  }
  const plan = planFromJson(content, path);
  return applyActionPlan(plan, {
    yes: options.yes,
    approveReviewRequired: options.approveReviewRequired,
    backup: options.backup,
  });
}

export function renderFixPlan(plan: ActionPlan, format: string | undefined = "text"): string {
  if (format === "json") {
    return `${JSON.stringify(plan, null, 2)}\n`;
  }
  if (format !== "text") {
    throw new Error(`Unsupported fix output format: ${format}`);
  }

  const lines = [
    `Fix plan: ${plan.issueIds.length} issue(s)`,
    "Issue IDs:",
    ...plan.issueIds.map((issueId) => `- ${issueId}`),
    "Patches:",
  ];
  if (plan.changes.length === 0) {
    lines.push("- None.");
  } else {
    for (const change of plan.changes) {
      const mode = change.modeBefore === undefined
        ? ""
        : ` mode ${change.modeBefore.toString(8)} -> ${change.modeAfter?.toString(8) ?? "unchanged"}`;
      lines.push(`- ${change.path} (${change.safety}${mode})`);
    }
  }

  lines.push("Manual steps:");
  if (plan.manualSteps.length === 0) {
    lines.push("- None.");
  } else {
    for (const manualStep of plan.manualSteps) {
      lines.push(`- ${manualStep.issueId}: ${manualStep.title}`);
      for (const step of manualStep.steps) {
        lines.push(`  - ${step}`);
      }
    }
  }
  lines.push("No Skill workspace files written by the plan operation.");
  return `${lines.join("\n")}\n`;
}

export function renderFixApply(receipt: ApplyReceipt, format: string | undefined = "text"): string {
  if (format === "json") {
    return `${JSON.stringify({
      ...receipt,
      appliedNotVerified: true,
      nextCommand: "skillsync verify",
    }, null, 2)}\n`;
  }
  if (format !== "text") {
    throw new Error(`Unsupported fix output format: ${format}`);
  }

  const lines = [
    `ActionPlan status: ${receipt.status}`,
    `Changed paths: ${receipt.changedPaths.length === 0 ? "none" : receipt.changedPaths.join(", ")}`,
  ];
  if (receipt.backupPath) {
    lines.push(`Backup: ${receipt.backupPath}`);
  }
  lines.push("Applied is not verified. Next command: skillsync verify");
  return `${lines.join("\n")}\n`;
}

export function renderFixApplyError(error: ActionPlanApplyError): string {
  return `${JSON.stringify({
    error: {
      name: error.name,
      message: error.message,
      ...(error.receipt === undefined ? {} : { receipt: error.receipt }),
      ...(error.rollbackError === undefined
        ? {}
        : { rollback: { failedPaths: error.rollbackError.failedPaths } }),
    },
  }, null, 2)}\n`;
}
