import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { BehaviorFixtureV2 } from "../domain/behavior-fixture.js";
import { computeBehaviorInputDigest, normalizeSandboxPath } from "../domain/behavior-v2.js";
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

async function copyRegularTree(source: string, target: string): Promise<void> {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) {
    throw new Error(`behavior.staging-escape: symlink is not allowed in staging: ${source}`);
  }
  if (metadata.isDirectory()) {
    await mkdir(target, { recursive: true, mode: 0o755 });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await copyRegularTree(join(source, entry.name), join(target, entry.name));
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new Error(`behavior.staging-escape: unsupported filesystem entry: ${source}`);
  }
  await mkdir(resolve(target, ".."), { recursive: true, mode: 0o755 });
  await copyFile(source, target);
}

export async function stageBehaviorFixture(input: {
  fixtureRoot: string;
  manifest: BehaviorFixtureV2;
  skillPath: string;
  replayTracePath?: string;
  runId: string;
}): Promise<StagedBehaviorFixture> {
  const fixtureRoot = resolve(input.fixtureRoot);
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

  const stageRoot = await mkdtemp(join(tmpdir(), `skillsync-sandbox-${input.runId}-`));
  const stagedWorkspace = join(stageRoot, "workspace");
  const stagedSkill = join(stagedWorkspace, normalizedSkillPath);
  const stagedTracePath = normalizedTracePath ? join(stagedWorkspace, normalizedTracePath) : undefined;
  let cleaned = false;

  try {
    await mkdir(stagedWorkspace, { recursive: true, mode: 0o755 });
    await copyRegularTree(skillSource, stagedSkill);
    if (traceSource && stagedTracePath) {
      await copyRegularTree(traceSource, stagedTracePath);
    }

    const inventory = await scanInventory([
      { name: `behavior-${input.manifest.id}`, path: skillSource, scope: "explicit" },
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
