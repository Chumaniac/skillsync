import { createHash } from "node:crypto";

import type { SkillFile } from "./skill.js";

export type DigestFile = Pick<SkillFile, "relativePath" | "content" | "mode" | "isSymlink"> & {
  /** Filesystem metadata is accepted at the boundary but intentionally ignored. */
  mtimeMs?: number;
  inode?: number;
};

export class InvalidSkillPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSkillPathError";
  }
}

export function normalizeRelativePath(input: string): string {
  if (input.includes("\0")) {
    throw new InvalidSkillPathError("Skill path contains a null byte");
  }

  const normalized = input.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new InvalidSkillPathError(`Absolute Skill path is not allowed: ${input}`);
  }

  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new InvalidSkillPathError(`Path traversal is not allowed: ${input}`);
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new InvalidSkillPathError("Skill path must not be empty");
  }

  return segments.join("/");
}

export function computeSkillDigest(files: readonly DigestFile[]): string {
  const normalizedFiles = files.map((file) => ({
    relativePath: normalizeRelativePath(file.relativePath),
    content: file.content,
    mode: file.mode,
    isSymlink: file.isSymlink,
  }));

  const paths = new Set<string>();
  for (const file of normalizedFiles) {
    if (paths.has(file.relativePath)) {
      throw new InvalidSkillPathError(`Duplicate normalized Skill path: ${file.relativePath}`);
    }
    paths.add(file.relativePath);
  }

  normalizedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const hash = createHash("sha256");
  for (const file of normalizedFiles) {
    const header = JSON.stringify({
      path: file.relativePath,
      mode: file.mode,
      isSymlink: file.isSymlink,
      byteLength: file.content.byteLength,
    });
    hash.update(`${header}\n`);
    hash.update(file.content);
  }

  return `sha256:${hash.digest("hex")}`;
}
