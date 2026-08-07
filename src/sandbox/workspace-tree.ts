import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
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

export async function scanStagedWorkspace(rootPath: string): Promise<WorkspaceTree> {
  const root = resolve(rootPath);
  const rootMetadata = await lstat(root).catch(() => undefined);
  if (!rootMetadata || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new WorkspaceTreeError("staged workspace must be a regular directory");
  }

  const files: VirtualFileObservation[] = [];
  let totalBytes = 0;

  async function visit(current: string): Promise<void> {
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new WorkspaceTreeError("symlinks are not allowed in the staged workspace");
    }
    if (metadata.isDirectory()) {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(join(current, entry.name));
      }
      return;
    }
    if (!metadata.isFile()) {
      throw new WorkspaceTreeError("only regular files are allowed in the staged workspace");
    }
    if (metadata.size > WORKSPACE_TREE_LIMITS.maxFileBytes) {
      throw new WorkspaceTreeLimitError("a staged workspace file exceeds the size limit");
    }
    if (files.length >= WORKSPACE_TREE_LIMITS.maxFiles || totalBytes + metadata.size > WORKSPACE_TREE_LIMITS.maxTotalBytes) {
      throw new WorkspaceTreeLimitError("staged workspace exceeds the tree size limit");
    }

    const content = await readFile(current);
    const digest = createHash("sha256").update(content).digest("hex");
    files.push({
      path: workspacePath(root, current),
      bytes: content.byteLength,
      digest: `sha256:${digest}`,
    });
    totalBytes += content.byteLength;
  }

  await visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, digest: treeDigest(files) };
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
