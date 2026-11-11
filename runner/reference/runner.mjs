#!/usr/bin/env node
/* global process */

import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const PROTOCOL = "skillsync.runner.v1";
const WORKSPACE = process.env.SKILLSYNC_WORKSPACE ?? "/workspace";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function invalidInput() {
  process.stderr.write("skillsync-runner: invalid input contract\n");
  process.exitCode = 2;
}

function invalidRelativePath(value) {
  if (!value || value.includes("\0") || isAbsolute(value)) {
    return true;
  }
  const normalized = value.replaceAll("\\", "/");
  return /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((segment) => segment === "..");
}

function requiredEnvironment() {
  const protocol = process.env.SKILLSYNC_PROTOCOL;
  const runId = process.env.SKILLSYNC_RUN_ID;
  const inputDigest = process.env.SKILLSYNC_INPUT_DIGEST;
  const agent = process.env.SKILLSYNC_AGENT;
  const skillPath = process.env.SKILLSYNC_SKILL_PATH;
  if (
    protocol !== PROTOCOL ||
    !runId ||
    !inputDigest ||
    !DIGEST_PATTERN.test(inputDigest) ||
    !agent ||
    !skillPath ||
    invalidRelativePath(skillPath)
  ) {
    return null;
  }
  return { runId, inputDigest, agent, skillPath };
}

function emit(sequence, type, payload) {
  process.stdout.write(`${JSON.stringify({
    protocol: PROTOCOL,
    runId: required.runId,
    seq: sequence,
    atMs: sequence,
    type,
    payload,
  })}\n`);
}

const required = requiredEnvironment();
if (!required) {
  invalidInput();
} else {
  try {
    const skillRoot = resolve(WORKSPACE, required.skillPath);
    const skillRootRelative = relative(resolve(WORKSPACE), skillRoot);
    if (
      !skillRootRelative ||
      skillRootRelative === ".." ||
      skillRootRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
      invalidInput();
    } else {
      const rootMetadata = await lstat(skillRoot);
      const skillFile = join(skillRoot, "SKILL.md");
      const fileMetadata = await lstat(skillFile);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || !fileMetadata.isFile() || fileMetadata.isSymbolicLink()) {
        throw new Error("invalid Skill tree");
      }

      const content = await readFile(skillFile);
      const eventPath = `workspace/${required.skillPath.replaceAll("\\", "/")}/SKILL.md`;
      emit(0, "run.started", {
        agent: required.agent,
        skillPath: required.skillPath,
        inputDigest: required.inputDigest,
      });
      emit(1, "tool.call", { tool: "fs.read", operation: "start", callId: "reference-read" });
      emit(2, "fs.read", { path: eventPath, bytes: content.byteLength });
      emit(3, "tool.call", { tool: "fs.read", operation: "finish", callId: "reference-read", result: "ok" });
      emit(4, "run.finished", { status: "passed", exitCode: 0 });
      process.exitCode = 0;
    }
  } catch {
    process.stderr.write("skillsync-runner: execution failed\n");
    process.exitCode = 1;
  }
}
