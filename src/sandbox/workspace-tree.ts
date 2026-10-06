import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { normalizeSandboxPath } from "../domain/behavior-v2.js";
import type { VirtualFileObservation, WorkspaceTree } from "./types.js";

export const WORKSPACE_TREE_LIMITS = {
  maxFiles: 10_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
} as const;

export class WorkspaceTreeError extends Error {
  readonly code: "workspace.tree-invalid" | "workspace.tree-too-large";

  constructor(message: string, code: "workspace.tree-invalid" | "workspace.tree-too-large" = "workspace.tree-invalid") {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "WorkspaceTreeError";
  }
}

export class WorkspaceTreeLimitError extends WorkspaceTreeError {
  constructor(message: string) {
    super(message, "workspace.tree-too-large");
    this.name = "WorkspaceTreeLimitError";
  }
}

function treeDigest(files: readonly VirtualFileObservation[]): string {
  const canonical = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

function workspacePath(root: string, filePath: string): string {
  const relativePath = relative(root, filePath).replaceAll("\\", "/");
  if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new WorkspaceTreeError("file escaped the staged workspace");
  }
  return `workspace/${normalizeSandboxPath(relativePath, "workspace tree path", "workspace")}`;
}

export type WorkspaceTreeScanOptions = {
  limits?: Partial<{ maxFiles: number; maxFileBytes: number; maxTotalBytes: number }>;
  allowedFiles?: ReadonlySet<string>;
  inspectFile?: (path: string, content: Buffer, observation: VirtualFileObservation) => void | Promise<void>;
};

function unchanged(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

export async function readWorkspaceFile(path: string, maxBytes: number, expected?: Stats): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WORKSPACE_TREE_LIMITS.maxFileBytes) {
    throw new WorkspaceTreeLimitError("invalid file read limit");
  }
  try {
    const metadata = expected ?? await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new WorkspaceTreeError("only regular files are readable");
    if (!Number.isSafeInteger(metadata.size) || metadata.size > maxBytes) throw new WorkspaceTreeLimitError("file exceeds the read limit");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || !unchanged(metadata, before)) throw new WorkspaceTreeError("workspace changed during inspection");
      const buffer = Buffer.alloc(metadata.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== metadata.size || !unchanged(before, await handle.stat()) || !unchanged(metadata, await lstat(path))) {
        throw new WorkspaceTreeError("workspace changed during inspection");
      }
      return buffer.subarray(0, offset);
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof WorkspaceTreeError) throw error;
    throw new WorkspaceTreeError("workspace file is inaccessible or changed");
  }
}

export async function scanStagedWorkspace(rootPath: string, options: WorkspaceTreeScanOptions = {}): Promise<WorkspaceTree> {
  const root = resolve(rootPath);
  const limits = { ...WORKSPACE_TREE_LIMITS, ...options.limits };
  for (const key of ["maxFiles", "maxFileBytes", "maxTotalBytes"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > WORKSPACE_TREE_LIMITS[key]) {
      throw new WorkspaceTreeLimitError("requested limits must be positive and within workspace ceilings");
    }
  }
  const rootMetadata = await lstat(root).catch(() => undefined);
  if (!rootMetadata || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new WorkspaceTreeError("staged workspace must be a regular directory");
  }
  const inventory: Array<{ absolute: string; path: string; metadata: Stats }> = [];
  const directories: Array<{ absolute: string; metadata: Stats }> = [];
  let totalBytes = 0;
  let entriesSeen = 0;
  const allowedDirectories = new Set<string>();
  for (const path of options.allowedFiles ?? []) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) allowedDirectories.add(parts.slice(0, index).join("/"));
  }
  async function visit(current: string, depth: number): Promise<void> {
    if (depth > 64) throw new WorkspaceTreeLimitError("workspace directory depth exceeds the limit");
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new WorkspaceTreeError("symlinks are not allowed in the staged workspace");
    const path = current === root ? "" : workspacePath(root, current).slice("workspace/".length);
    if (metadata.isDirectory()) {
      if (path && options.allowedFiles && !allowedDirectories.has(path)) {
        throw new WorkspaceTreeError("directory is not declared by the artifact contract");
      }
      directories.push({ absolute: current, metadata });
      // Stream directory entries so the inventory cap also bounds enumeration.
      for await (const entry of await opendir(current)) {
        entriesSeen += 1;
        if (entriesSeen > 20_000) throw new WorkspaceTreeLimitError("workspace entry count exceeds the limit");
        if (entry.name.includes("\\") || /\p{Cc}/u.test(entry.name)) {
          throw new WorkspaceTreeError("unsafe workspace file name");
        }
        await visit(join(current, entry.name), depth + 1);
      }
      return;
    }
    if (!metadata.isFile()) throw new WorkspaceTreeError("only regular files are allowed in the staged workspace");
    if (options.allowedFiles && !options.allowedFiles.has(path)) {
      throw new WorkspaceTreeError("file is not declared by the artifact contract");
    }
    if (!Number.isSafeInteger(metadata.size) || metadata.size > limits.maxFileBytes) {
      throw new WorkspaceTreeLimitError("a staged workspace file exceeds the size limit");
    }
    if (inventory.length >= limits.maxFiles || totalBytes + metadata.size > limits.maxTotalBytes) {
      throw new WorkspaceTreeLimitError("staged workspace exceeds the tree size limit");
    }
    totalBytes += metadata.size;
    inventory.push({ absolute: current, path, metadata });
  }
  // Validate the complete metadata inventory before reading any payload, so an
  // undeclared private file or oversized tree never reaches the content hook.
  try {
    await visit(root, 0);
    const files: VirtualFileObservation[] = [];
    for (const entry of inventory) {
      const content = await readWorkspaceFile(entry.absolute, limits.maxFileBytes, entry.metadata);
      const observation = { path: `workspace/${entry.path}`, bytes: content.byteLength,
        digest: `sha256:${createHash("sha256").update(content).digest("hex")}` };
      files.push(observation);
      await options.inspectFile?.(entry.path, content, observation);
    }
    for (const entry of [...inventory, ...directories]) {
      const after = await lstat(entry.absolute);
      if (after.isSymbolicLink() || !unchanged(entry.metadata, after)) throw new WorkspaceTreeError("workspace changed during inspection");
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    return { files, digest: treeDigest(files) };
  } catch (error) {
    if (error instanceof WorkspaceTreeError) throw error;
    throw new WorkspaceTreeError("workspace file is inaccessible or changed");
  }
}

export function workspaceTreeDelta(
  before: WorkspaceTree,
  after: WorkspaceTree,
): { changed: VirtualFileObservation[]; deleted: string[] } {
  const beforeFiles = new Map(before.files.map((file) => [file.path, file]));
  const afterFiles = new Map(after.files.map((file) => [file.path, file]));
  const changed = [...afterFiles.values()].filter((file) => {
    const previous = beforeFiles.get(file.path);
    return !previous || previous.bytes !== file.bytes || previous.digest !== file.digest;
  });
  const deleted = [...beforeFiles.keys()].filter((path) => !afterFiles.has(path)).sort();
  return { changed, deleted };
}
