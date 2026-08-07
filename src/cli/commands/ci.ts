import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { normalizeRelativePath } from "../../domain/digest.js";

export type CiTarget = "github" | "pre-commit";

export type CiInitOptions = {
  target: CiTarget;
  nodeVersion: string;
  packageVersion?: string;
  paths: string[];
  cwd?: string;
  apply?: boolean;
  force?: boolean;
};

export type CiInitResult = {
  target: CiTarget;
  outputPath: string;
  content: string;
  applied: boolean;
};

const DEFAULT_PATHS = [".agents/skills", ".claude/skills", ".cursor/skills"];
const DEFAULT_PACKAGE_VERSION = "0.1.0";

function validateNodeVersion(value: string): string {
  if (!/^\d+(?:\.\d+){0,2}$/.test(value)) {
    throw new Error("Node version must contain only numeric version segments.");
  }
  return value;
}

function validatePackageVersion(value: string | undefined): string {
  const version = value ?? DEFAULT_PACKAGE_VERSION;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("SkillSync package version must be a valid pinned semver version.");
  }
  return version;
}

function validatePaths(values: string[]): string[] {
  const paths = values.length > 0 ? values : DEFAULT_PATHS;
  return paths.map((path) => {
    if (!/^[A-Za-z0-9._/-]+$/.test(path) || path.includes("\n") || path.includes("\r")) {
      throw new Error(`Unsafe CI path: ${path}`);
    }
    return normalizeRelativePath(path);
  });
}

function shellPaths(paths: string[]): string {
  return paths.map((path) => `--path ${path}`).join(" ");
}

export function renderGitHubAction(options: { nodeVersion: string; packageVersion?: string; paths: string[] }): string {
  const nodeVersion = validateNodeVersion(options.nodeVersion);
  const packageVersion = validatePackageVersion(options.packageVersion);
  const paths = validatePaths(options.paths);
  const pathFilters = paths.map((path) => `      - "${path}/**"`).join("\n");
  return `name: SkillSync

on:
  pull_request:
    paths:
${pathFilters}

permissions:
  contents: read
  security-events: write

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
      # Requires the published skillsync@${packageVersion} package; publication remains an explicit release step.
      - run: npx --yes skillsync@${packageVersion} verify --format sarif ${shellPaths(paths)} > skillsync.sarif
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: skillsync.sarif
`;
}

export function renderPreCommit(options: { packageVersion?: string; paths: string[] }): string {
  const packageVersion = validatePackageVersion(options.packageVersion);
  const paths = validatePaths(options.paths);
  return `repos:
  - repo: local
    hooks:
      - id: skillsync-verify
        name: Verify Agent Skills with SkillSync
        entry: npx --yes skillsync@${packageVersion} verify --format json ${shellPaths(paths)}
        language: system
        pass_filenames: false
`;
}

export async function runCiInit(options: CiInitOptions): Promise<CiInitResult> {
  const paths = validatePaths(options.paths);
  const packageVersion = validatePackageVersion(options.packageVersion);
  const content = options.target === "github"
    ? renderGitHubAction({ nodeVersion: options.nodeVersion, packageVersion, paths })
    : renderPreCommit({ packageVersion, paths });
  const cwd = resolve(options.cwd ?? process.cwd());
  const outputPath = options.target === "github"
    ? join(cwd, ".github/workflows/skillsync.yml")
    : join(cwd, ".pre-commit-config.yaml");

  if (!options.apply) {
    return { target: options.target, outputPath, content, applied: false };
  }

  try {
    await access(outputPath);
    if (!options.force) {
      throw new Error(`Refusing to overwrite ${outputPath}; pass --force to replace it.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing to overwrite")) {
      throw error;
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  return { target: options.target, outputPath, content, applied: true };
}
