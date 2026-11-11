import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  realpath,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { BehaviorFixtureV2 } from "../domain/behavior-fixture.js";
import { computeBehaviorInputDigest, normalizeSandboxPath } from "../domain/behavior-v2.js";
import type { Stats } from "node:fs";
import { readWorkspaceFile, WORKSPACE_TREE_LIMITS, WorkspaceTreeLimitError } from "./workspace-tree.js";
import { scanInventory } from "../domain/inventory.js";

export type StagedBehaviorFixture = {
  stagedWorkspace: string;
  stagedTracePath?: string;
  inputDigest: string;
  cleanup(): Promise<void>;
};

function assertRelativeInside(root: string, input: string, label: string, allowDot = false): string {
  const normalized = input.replaceAll("\\", "/");
  if (normalized.includes("\0") || isAbsolute(input) || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`behavior.staging-escape: ${label} must remain inside the fixture root`);
  }
  const candidate = resolve(root, input);
  const relativePath = relative(root, candidate);
  if (
    (!allowDot && relativePath === "") ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`behavior.staging-escape: ${label} must remain inside the fixture root`);
  }
  return candidate;
}

type CopyBudget = { files: number; bytes: number; entries: number; observations: Array<{ path: string; metadata: Stats }> };

function unchanged(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function copyRegularTree(source: string, target: string, budget: CopyBudget, depth = 0): Promise<void> {
  if (depth > 64) throw new WorkspaceTreeLimitError("staging depth exceeds the limit");
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error("behavior.staging-escape: symlink is not allowed in staging");
  budget.observations.push({ path: source, metadata });
  if (metadata.isDirectory()) {
    await mkdir(target, { recursive: true, mode: 0o755 });
    for await (const entry of await opendir(source)) {
      if (++budget.entries > 20_000) throw new WorkspaceTreeLimitError("staging entry count exceeds the limit");
      if (entry.name.includes("\\") || /\p{Cc}/u.test(entry.name)) throw new Error("behavior.staging-escape: unsafe file name");
      await copyRegularTree(join(source, entry.name), join(target, entry.name), budget, depth + 1);
    }
    return;
  }
  if (!metadata.isFile()) throw new Error("behavior.staging-escape: unsupported filesystem entry");
  budget.files += 1;
  budget.bytes += metadata.size;
  if (budget.files > WORKSPACE_TREE_LIMITS.maxFiles || budget.bytes > WORKSPACE_TREE_LIMITS.maxTotalBytes) {
    throw new WorkspaceTreeLimitError("staging file count or total bytes exceeds the limit");
  }
  const content = await readWorkspaceFile(source, WORKSPACE_TREE_LIMITS.maxFileBytes, metadata);
  await mkdir(resolve(target, ".."), { recursive: true, mode: 0o755 });
  await writeFile(target, content, { mode: metadata.mode & 0o777 });
  await chmod(target, metadata.mode & 0o777);
}

export async function stageBehaviorFixture(input: {
  fixtureRoot: string;
  manifest: BehaviorFixtureV2;
  skillPath: string;
  replayTracePath?: string;
  runId: string;
}): Promise<StagedBehaviorFixture> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.runId)) throw new Error("behavior.staging-invalid: invalid run identifier");
  const fixtureRoot = await realpath(resolve(input.fixtureRoot));
  const skillSource = assertRelativeInside(fixtureRoot, input.skillPath, "skill_path", true);
  const normalizedSkillPath = input.skillPath === "."
    ? "skill"
    : normalizeSandboxPath(input.skillPath, "skill_path", "workspace");
  const traceSource = input.replayTracePath
    ? assertRelativeInside(fixtureRoot, input.replayTracePath, "replay_trace")
    : undefined;
  const normalizedTracePath = input.replayTracePath
    ? normalizeSandboxPath(input.replayTracePath, "replay_trace", "workspace")
    : undefined;

  for (const source of [skillSource, traceSource].filter((path): path is string => Boolean(path))) {
    let current = fixtureRoot;
    for (const component of relative(fixtureRoot, source).split(/[\\/]/).filter(Boolean)) {
      current = join(current, component);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("behavior.staging-escape: symlink in declared path");
    }
  }
  const stageRoot = await mkdtemp(join(tmpdir(), `skillsync-sandbox-${input.runId}-`));
  const stagedWorkspace = join(stageRoot, "workspace");
  const stagedSkill = join(stagedWorkspace, normalizedSkillPath);
  const stagedTracePath = normalizedTracePath ? join(stagedWorkspace, normalizedTracePath) : undefined;
  let cleaned = false;

  try {
    await mkdir(stagedWorkspace, { recursive: true, mode: 0o755 });
    const budget: CopyBudget = { files: 0, bytes: 0, entries: 0, observations: [] };
    await copyRegularTree(skillSource, stagedSkill, budget);
    if (traceSource && stagedTracePath) {
      await copyRegularTree(traceSource, stagedTracePath, budget);
    }

    for (const observation of budget.observations) {
      if (!unchanged(observation.metadata, await lstat(observation.path))) {
        throw new Error("behavior.staging-invalid: input changed while staging");
      }
    }
    const inventory = await scanInventory([
      { name: `behavior-${input.manifest.id}`, path: stagedSkill, scope: "explicit" },
    ]);
    if (inventory.skills.length !== 1) {
      throw new Error("behavior.staging-invalid: staged Skill must resolve to exactly one Skill");
    }
    const inputDigest = computeBehaviorInputDigest(input.manifest, inventory.skills[0].files);

    return {
      stagedWorkspace,
      stagedTracePath,
      inputDigest,
      cleanup: async () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        await rm(stageRoot, { recursive: true, force: true });
      },
    };
  } catch (error: unknown) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}
