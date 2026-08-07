import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { compareIssues, createBaseline, type Baseline, type IssueComparison } from "../../domain/baseline.js";
import { scanInventory } from "../../domain/inventory.js";
import { runVerification } from "./verify.js";

export type BaselineCreateOptions = {
  path: string;
  output: string;
  targets: string[];
  policyPath?: string;
};

export type BaselineCheckOptions = {
  path: string;
  from: string;
  targets: string[];
  policyPath?: string;
};

export type BaselineCheckReport = {
  schema_version: 1;
  rootDigest: string;
  comparison: IssueComparison;
  exitCode: 0 | 1 | 2 | 3 | 4;
};

export type BaselineFormat = "text" | "json";

const ISSUE_ID_PATTERN = /^iss_[0-9a-f]{64}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

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

function isWithinOrEqual(rootPath: string, candidatePath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath);
  return pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

async function requireDirectSkillRoot(path: string): Promise<string> {
  const rootPath = resolve(path);
  try {
    if (!(await stat(rootPath)).isDirectory()) throw new Error("not a directory");
    const skillMd = await lstat(join(rootPath, "SKILL.md"));
    if (!skillMd.isFile() && !skillMd.isSymbolicLink()) throw new Error("SKILL.md is not a file");
  } catch {
    throw new Error("baseline requires --path to be a Skill root containing a direct SKILL.md.");
  }
  return rootPath;
}

async function readBaseline(path: string): Promise<Baseline> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new Error("Cannot read baseline file.");
  }
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Cannot parse baseline file.");
  }
  if (!isObject(value) || value.schema_version !== 1 || !validDigest(value.rootDigest) ||
    !Array.isArray(value.skills) || !Array.isArray(value.issues) ||
    !validDigest(value.profileFingerprint) || !validDigest(value.policyFingerprint) ||
    !value.skills.every((skill) => isObject(skill) && typeof skill.name === "string" && skill.name.length > 0 &&
      validDigest(skill.digest)) ||
    !value.issues.every((issue) => isObject(issue) && validIssueId(issue.id) &&
      ["open", "acknowledged", "resolved", "ignored"].includes(String(issue.state)) &&
      (issue.state !== "ignored"
        ? issue.reason === undefined || typeof issue.reason === "string"
        : typeof issue.reason === "string" && issue.reason.trim().length > 0))) {
    throw new Error("Invalid baseline file.");
  }
  return value as unknown as Baseline;
}

async function policyFingerprint(path: string | undefined): Promise<string> {
  if (path === undefined) return digest({ policy: "default" });
  try {
    return digest(await readFile(path, "utf8"));
  } catch {
    throw new Error("Cannot read policy file.");
  }
}

async function currentBaselineInput(path: string, targets: string[], policyPath: string | undefined): Promise<{
  rootPath: string;
  rootDigest: string;
  skills: Array<{ name: string; digest: string }>;
  issues: Awaited<ReturnType<typeof runVerification>>["issues"];
  profileFingerprint: string;
  policyFingerprint: string;
  verificationExitCode: 0 | 1 | 2 | 3 | 4;
}> {
  const rootPath = await requireDirectSkillRoot(path);
  const verification = await runVerification({ paths: [rootPath], targets, policyPath });
  const inventory = await scanInventory([{ name: "baseline", path: rootPath, scope: "explicit" }]);
  const skills = inventory.skills.map((skill) => ({ name: skill.name, digest: skill.digest }));
  const rootDigest = digest({
    skills: [...skills].sort((left, right) => compareText(left.name, right.name) || compareText(left.digest, right.digest)),
    issues: verification.issues.map((issue) => ({ id: issue.id, state: issue.state, identity: issue.identity }))
      .sort((left, right) => compareText(left.id, right.id)),
  });
  return {
    rootPath,
    rootDigest,
    skills,
    issues: verification.issues,
    profileFingerprint: digest({ targets: [...targets].sort(compareText) }),
    policyFingerprint: await policyFingerprint(policyPath),
    verificationExitCode: verification.exitCode,
  };
}

async function assertBaselineOutputOutsideRoot(rootPath: string, outputPath: string): Promise<void> {
  const resolvedRoot = resolve(rootPath);
  const resolvedOutput = resolve(outputPath);
  if (isWithinOrEqual(resolvedRoot, resolvedOutput)) {
    throw new Error("baseline --create output must be outside the direct Skill root.");
  }

  const canonicalRoot = await realpath(resolvedRoot).catch(() => resolvedRoot);
  const canonicalOutputParent = await realpath(dirname(resolvedOutput)).catch(() => resolve(dirname(resolvedOutput)));
  if (isWithinOrEqual(canonicalRoot, canonicalOutputParent)) {
    throw new Error("baseline --create output must be outside the direct Skill root.");
  }
}

export async function runBaselineCreate(options: BaselineCreateOptions): Promise<Baseline> {
  const rootPath = await requireDirectSkillRoot(options.path);
  await assertBaselineOutputOutsideRoot(rootPath, options.output);
  const current = await currentBaselineInput(options.path, options.targets, options.policyPath);
  const baseline = createBaseline({
    rootDigest: current.rootDigest,
    skills: current.skills,
    issues: current.issues,
    profileFingerprint: current.profileFingerprint,
    policyFingerprint: current.policyFingerprint,
  });
  try {
    await writeFile(resolve(options.output), `${JSON.stringify(baseline, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new Error("Cannot create baseline file: already exists.");
    }
    throw new Error("Cannot write baseline file.");
  }
  return baseline;
}

export async function runBaselineCheck(options: BaselineCheckOptions): Promise<BaselineCheckReport> {
  const rootPath = await requireDirectSkillRoot(options.path);
  const baseline = await readBaseline(resolve(options.from));
  const verification = await runVerification({ paths: [rootPath], targets: options.targets, policyPath: options.policyPath });
  const inventory = await scanInventory([{ name: "baseline", path: rootPath, scope: "explicit" }]);
  const skills = inventory.skills.map((skill) => ({ name: skill.name, digest: skill.digest }))
    .sort((left, right) => compareText(left.name, right.name) || compareText(left.digest, right.digest));
  const before = baseline.issues.filter((issue) => issue.state !== "resolved");
  const comparison = compareIssues(before, verification.issues, baseline);
  return {
    schema_version: 1,
    rootDigest: digest({
      skills,
      issues: verification.issues.map((issue) => ({ id: issue.id, state: issue.state, identity: issue.identity }))
        .sort((left, right) => compareText(left.id, right.id)),
    }),
    comparison,
    exitCode: verification.exitCode,
  };
}

function list(ids: string[]): string {
  return ids.length === 0 ? "none" : ids.join(", ");
}

export function renderBaselineCreate(baseline: Baseline, format: BaselineFormat): string {
  if (format === "json") return `${JSON.stringify(baseline, null, 2)}\n`;
  return `Baseline created: ${baseline.skills.length} Skill(s), ${baseline.issues.length} Issue(s)\n`;
}

export function renderBaselineCheck(report: BaselineCheckReport, format: BaselineFormat): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  return [
    "Baseline check",
    `New: ${list(report.comparison.newIds)}`,
    `Ongoing: ${list(report.comparison.ongoingIds)}`,
    `Resolved: ${list(report.comparison.resolvedIds)}`,
    `Regressed: ${list(report.comparison.regressedIds)}`,
  ].join("\n") + "\n";
}
