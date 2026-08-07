import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { normalizeRelativePath } from "../../domain/digest.js";
import {
  parseBehaviorManifest,
  type BehaviorFixture,
} from "../../domain/behavior-fixture.js";
import {
  type BehaviorExecutionReport,
  type BehaviorFinding,
} from "../../domain/behavior-execution.js";
import { scanInventory } from "../../domain/inventory.js";
import { BehaviorCommandError, runBehaviorV2Test } from "./test-v2.js";

export type BehaviorTestOptions = {
  fixturePath?: string;
  agent?: string;
  execute?: boolean;
  backend?: string;
};

export type BehaviorFixtureSummary = {
  id: string;
  path: string;
  description: string;
};

export type BehaviorTestReport = {
  schema_version: 1;
  fixture: BehaviorFixtureSummary;
  agent?: string;
  status: "preflight-pass" | "preflight-fail";
  execution: "not-run";
  findings: BehaviorFinding[];
  summary: {
    pass: number;
    fail: number;
    not_run: number;
  };
  exitCode: 0 | 1;
};

export type BehaviorFixtureListReport = {
  schema_version: 1;
  fixtures: BehaviorFixtureSummary[];
};

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "Unknown error";
}

function fixturePathError(path: string, label: string): Error {
  return new Error(`${label} must remain inside the fixture root: ${path}`);
}

function assertRelativePath(input: string, label: string, allowDot = false): void {
  if (input.includes("\0")) {
    throw fixturePathError(input, label);
  }

  const normalized = input.replaceAll("\\", "/");
  if (isAbsolute(input) || /^[A-Za-z]:/.test(normalized)) {
    throw fixturePathError(input, label);
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw fixturePathError(input, label);
    }
  }

  if (!allowDot && segments.every((segment) => segment === "" || segment === ".")) {
    throw fixturePathError(input, label);
  }
}

function resolveFixturePath(fixtureRoot: string, input: string, label: string): string {
  assertRelativePath(input, label, true);
  const candidate = resolve(fixtureRoot, input);
  const relativePath = relative(fixtureRoot, candidate);
  if (relativePath !== "" && (relativePath.startsWith("../") || isAbsolute(relativePath))) {
    throw fixturePathError(input, label);
  }
  return candidate;
}

function parseManifest(content: string, manifestPath: string): BehaviorFixture {
  return parseBehaviorManifest(content, manifestPath);
}

async function readManifest(fixtureRoot: string): Promise<BehaviorFixture> {
  const manifestPath = join(fixtureRoot, "behavior.yaml");
  let metadata;
  try {
    metadata = await lstat(manifestPath);
  } catch (error: unknown) {
    throw new Error(`Cannot read behavior fixture ${manifestPath}: ${firstLine(error)}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Behavior fixture manifest is not a regular file: ${manifestPath}`);
  }

  let content: string;
  try {
    content = await readFile(manifestPath, "utf8");
  } catch (error: unknown) {
    throw new Error(`Cannot read behavior fixture ${manifestPath}: ${firstLine(error)}`);
  }

  try {
    return parseManifest(content, manifestPath);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Invalid behavior fixture")) {
      if (/^\s*schema_version\s*:\s*2\s*$/m.test(content)) {
        throw new BehaviorCommandError(error.message, 2);
      }
      throw error;
    }
    throw new Error(`Cannot read behavior fixture ${manifestPath}: ${firstLine(error)}`);
  }
}

async function requireFixtureDirectory(path: string): Promise<string> {
  const fixtureRoot = resolve(path);
  let metadata;
  try {
    metadata = await lstat(fixtureRoot);
  } catch (error: unknown) {
    throw new Error(`Cannot read behavior fixture directory ${fixtureRoot}: ${firstLine(error)}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Behavior fixture path is not a directory: ${fixtureRoot}`);
  }
  return fixtureRoot;
}

function finding(
  code: BehaviorFinding["code"],
  status: BehaviorFinding["status"],
  message: string,
  evidence: Array<Record<string, string>> = [],
): BehaviorFinding {
  return { code, status, message, evidence };
}

function summarize(findings: BehaviorFinding[]): BehaviorTestReport["summary"] {
  return {
    pass: findings.filter((item) => item.status === "pass").length,
    fail: findings.filter((item) => item.status === "fail").length,
    not_run: findings.filter((item) => item.status === "not-run").length,
  };
}

function normalizedFilePaths(files: Array<{ relativePath: string }>): Set<string> {
  return new Set(
    files.map((file) => {
      try {
        return normalizeRelativePath(file.relativePath);
      } catch {
        return file.relativePath;
      }
    }),
  );
}

function hasForbiddenPath(filePaths: Set<string>, forbiddenPath: string): boolean {
  return [...filePaths].some(
    (filePath) => filePath === forbiddenPath || filePath.startsWith(`${forbiddenPath}/`),
  );
}

export async function runBehaviorTest(
  options: BehaviorTestOptions,
): Promise<BehaviorTestReport | BehaviorExecutionReport> {
  if (!options.fixturePath) {
    throw new Error("test requires --fixture <path> unless --list is used.");
  }

  const fixtureRoot = await requireFixtureDirectory(options.fixturePath);
  const manifest = await readManifest(fixtureRoot);
  if (manifest.schema_version === 2) {
    return runBehaviorV2Test({
      fixtureRoot,
      manifest,
      execute: options.execute ?? false,
      backend: options.backend,
    });
  }
  if (options.execute) {
    throw new BehaviorCommandError(
      "schema_version: 1 fixtures cannot execute; migrate the fixture to schema_version: 2",
      2,
    );
  }
  const skillRoot = resolveFixturePath(fixtureRoot, manifest.skill_path, "skill_path");
  const requiredFiles = manifest.required_files.map((path) => normalizeRelativePath(path));
  const forbiddenPaths = manifest.forbidden_paths.map((path) => normalizeRelativePath(path));
  const findings: BehaviorFinding[] = [];
  const fixture = {
    id: manifest.id,
    path: fixtureRoot,
    description: manifest.description,
  };

  const inventory = await scanInventory([
    {
      name: `behavior-${manifest.id}`,
      path: skillRoot,
      scope: "explicit",
    },
  ]);

  if (inventory.skills.length !== 1) {
    findings.push(
      finding(
        "behavior.skill-not-found",
        "fail",
        "Fixture skill_path must resolve to exactly one Skill.",
        [{ path: skillRoot, discovered: String(inventory.skills.length) }],
      ),
    );
  } else {
    const filePaths = normalizedFilePaths(inventory.skills[0].files);
    for (const requiredPath of requiredFiles) {
      const present = filePaths.has(requiredPath);
      findings.push(
        finding(
          "behavior.required-file",
          present ? "pass" : "fail",
          present
            ? `Required file is present: ${requiredPath}.`
            : `Required file is missing: ${requiredPath}.`,
          [{ path: requiredPath }],
        ),
      );
    }

    for (const forbiddenPath of forbiddenPaths) {
      const present = hasForbiddenPath(filePaths, forbiddenPath);
      findings.push(
        finding(
          "behavior.forbidden-path",
          present ? "fail" : "pass",
          present
            ? `Forbidden path is present: ${forbiddenPath}.`
            : `Forbidden path is absent: ${forbiddenPath}.`,
          [{ path: forbiddenPath }],
        ),
      );
    }
  }

  findings.push(
    finding(
      "behavior.execution-not-run",
      "not-run",
      "Agent execution was not run by this fixture-only preflight.",
      [{ execution: "not-run" }],
    ),
  );

  const summary = summarize(findings);
  return {
    schema_version: 1,
    fixture,
    ...(options.agent ? { agent: options.agent } : {}),
    status: summary.fail > 0 ? "preflight-fail" : "preflight-pass",
    execution: "not-run",
    findings,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0,
  };
}

export async function listBehaviorFixtures(rootPath: string): Promise<BehaviorFixtureSummary[]> {
  const root = resolve(rootPath);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw new Error(`Cannot list behavior fixtures ${root}: ${firstLine(error)}`);
  }

  const summaries: BehaviorFixtureSummary[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fixtureRoot = join(root, entry.name);
    const manifestPath = join(fixtureRoot, "behavior.yaml");
    try {
      const metadata = await lstat(manifestPath);
      if (!metadata.isFile()) {
        continue;
      }
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw new Error(`Cannot list behavior fixture ${manifestPath}: ${firstLine(error)}`);
    }

    const manifest = await readManifest(fixtureRoot);
    summaries.push({
      id: manifest.id,
      path: fixtureRoot,
      description: manifest.description,
    });
  }

  return summaries.sort((left, right) => left.id.localeCompare(right.id));
}

export function renderBehaviorTest(
  value: BehaviorTestReport | BehaviorExecutionReport | BehaviorFixtureListReport,
  format: string | undefined,
): string {
  if (format === "json") {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  if (format !== undefined && format !== "text") {
    throw new Error(`Unsupported test output format: ${format}`);
  }

  if ("fixtures" in value) {
    const lines = [`Behavior fixtures: ${value.fixtures.length}`];
    for (const fixture of value.fixtures) {
      lines.push(`- ${fixture.id}: ${fixture.description} (${fixture.path})`);
    }
    return `${lines.join("\n")}\n`;
  }

  if ("preflight" in value) {
    const lines = [
      `Behavior v2: ${value.fixture.id} (${value.preflight.status})`,
      `Execution: ${value.execution.status}`,
      ...(value.execution.backend ? [`Backend: ${value.execution.backend}`] : []),
    ];
    for (const item of [...value.preflight.findings, ...value.execution.findings]) {
      lines.push(`- [${item.status}] ${item.code}: ${item.message}`);
    }
    lines.push(`Exit code: ${value.execution.exit_code}`);
    return `${lines.join("\n")}\n`;
  }

  const lines = [
    `Behavior preflight: ${value.fixture.id} (${value.status})`,
    `Execution: ${value.execution}`,
  ];
  if (value.agent) {
    lines.push(`Agent: ${value.agent}`);
  }
  for (const item of value.findings) {
    lines.push(`- [${item.status}] ${item.code}: ${item.message}`);
  }
  lines.push(
    `Summary: ${value.summary.pass} pass, ${value.summary.fail} fail, ${value.summary.not_run} not-run`,
  );
  return `${lines.join("\n")}\n`;
}
