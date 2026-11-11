import { access, lstat, mkdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DEFAULT_NPM_VERSION } from "../../capabilities.js";
import { normalizeRelativePath } from "../../domain/digest.js";

export type CiTarget = "github" | "pre-commit";

export type CiInitOptions = {
  target: CiTarget;
  nodeVersion: string;
  packageVersion?: string;
  source?: "npm" | "github-source";
  sourceRevision?: string;
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
const DEFAULT_PACKAGE_VERSION = DEFAULT_NPM_VERSION;
const PUBLISHED_PACKAGE_NAME = "@chumanic/skillsync";

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

type InstallationOptions = { packageVersion?: string; source?: "npm" | "github-source"; sourceRevision?: string };
function installation(options: InstallationOptions) {
  const source = options.source ?? "npm";
  if (!["npm","github-source"].includes(source)) throw new Error("CI source must be npm or github-source.");
  if (source === "github-source") {
    if (options.packageVersion !== undefined) throw new Error("Choose one channel: source revision or npm package version.");
    if (!options.sourceRevision || !/^[a-f0-9]{40}$/.test(options.sourceRevision)) throw new Error("GitHub source requires a full 40-character lowercase commit, never a branch or mutable tag.");
    return {source,revision:options.sourceRevision,version:null};
  }
  if (options.sourceRevision !== undefined) throw new Error("Source revision requires the github-source channel.");
  return {source,revision:null,version:validatePackageVersion(options.packageVersion)};
}

function sourceBuildSteps(revision: string): string {
  return `      # Fixed source build; no Skill instructions or install lifecycle scripts execute.
      - name: Build the selected SkillSync source
        shell: bash
        run: |
          install_root="$(mktemp -d "$RUNNER_TEMP/skillsync-cli.XXXXXXXX")"
          git -C "$install_root" init --quiet
          git -C "$install_root" fetch --depth 1 https://github.com/Chumaniac/skillsync.git ${revision}
          git -C "$install_root" checkout --quiet --detach FETCH_HEAD
          test "$(git -C "$install_root" rev-parse HEAD)" = "${revision}"
          npm ci --ignore-scripts --prefix "$install_root"
          npm run build --prefix "$install_root"
          node "$install_root/dist/cli/index.js" capabilities --expect-source ${revision} --json
          echo "SKILLSYNC_CLI_ROOT=$install_root" >> "$GITHUB_ENV"
`;
}

export function renderGitHubAction(options: { nodeVersion: string; paths: string[] } & InstallationOptions): string {
  const nodeVersion = validateNodeVersion(options.nodeVersion);
  const selected = installation(options);
  const packageVersion = selected.version;
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
${selected.source === "github-source" ? sourceBuildSteps(selected.revision!) : `      # Requires the published ${PUBLISHED_PACKAGE_NAME}@${packageVersion} package.
      # Channel: npm; current-source extensions are not asserted for this pin.
`}      - run: ${selected.source === "github-source" ? 'node "$SKILLSYNC_CLI_ROOT/dist/cli/index.js"' : `npx --yes ${PUBLISHED_PACKAGE_NAME}@${packageVersion}`} verify --format sarif ${shellPaths(paths)} > skillsync.sarif
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: skillsync.sarif
`;
}

export function renderPreCommit(options: { packageVersion?: string; paths: string[] }): string {
  const packageVersion = validatePackageVersion(options.packageVersion);
  const paths = validatePaths(options.paths);
  return `# Channel: npm ${PUBLISHED_PACKAGE_NAME}@${packageVersion}; current-source extensions not asserted.
repos:
  - repo: local
    hooks:
      - id: skillsync-verify
        name: Verify Agent Skills with SkillSync
        entry: npx --yes ${PUBLISHED_PACKAGE_NAME}@${packageVersion} verify --format json ${shellPaths(paths)}
        language: system
        pass_filenames: false
`;
}

export async function runCiInit(options: CiInitOptions): Promise<CiInitResult> {
  const paths = validatePaths(options.paths);
  const selected = installation(options);
  if (options.target !== "github" && options.target !== "pre-commit") throw new Error("Template target must be github or pre-commit.");
  if (selected.source === "github-source" && options.target !== "github") throw new Error("The GitHub source channel is supported by the GitHub workflow only.");
  const packageVersion = selected.version ?? undefined;
  const content = options.target === "github"
    ? renderGitHubAction({ nodeVersion: options.nodeVersion, packageVersion, paths, source: options.source, sourceRevision: options.sourceRevision })
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

  const parents = options.target === "github" ? [join(cwd,".github"),dirname(outputPath)] : [];
  for (const parent of parents) {
    try { if ((await lstat(parent)).isSymbolicLink()) throw new Error("CI output directories must not be symbolic links."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await mkdir(dirname(outputPath), { recursive: true });
  try { if ((await lstat(outputPath)).isSymbolicLink()) throw new Error("CI output must not be a symbolic link."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const file = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (options.force ? 0 : constants.O_EXCL), 0o600);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) throw new Error("CI output must be a regular single-link file.");
    if (options.force) await file.truncate(0);
    await file.writeFile(content,"utf8");
  } finally { await file.close(); }
  return { target: options.target, outputPath, content, applied: true };
}
