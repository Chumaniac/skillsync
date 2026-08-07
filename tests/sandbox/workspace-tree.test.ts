import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanStagedWorkspace, WorkspaceTreeError } from "../../src/sandbox/workspace-tree";

async function withWorkspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-workspace-tree-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("staged workspace tree", () => {
  it("returns deterministic workspace-relative file observations", async () => {
    await withWorkspace(async (root) => {
      await mkdir(join(root, "nested"), { recursive: true });
      await writeFile(join(root, "z.txt"), "last", "utf8");
      await writeFile(join(root, "nested", "a.txt"), "first", "utf8");

      const result = await scanStagedWorkspace(root);

      expect(result.files).toEqual([
        {
          path: "workspace/nested/a.txt",
          bytes: 5,
          digest: `sha256:${createHash("sha256").update("first").digest("hex")}`,
        },
        {
          path: "workspace/z.txt",
          bytes: 4,
          digest: `sha256:${createHash("sha256").update("last").digest("hex")}`,
        },
      ]);
      expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  it("rejects symlinks rather than dereferencing them", async () => {
    await withWorkspace(async (root) => {
      await writeFile(join(root, "outside.txt"), "secret", "utf8");
      await symlink(join(root, "outside.txt"), join(root, "link.txt"));

      await expect(scanStagedWorkspace(root)).rejects.toMatchObject<WorkspaceTreeError>({
        code: "workspace.tree-invalid",
      });
    });
  });

  it("rejects a non-directory root", async () => {
    await withWorkspace(async (root) => {
      const file = join(root, "file.txt");
      await writeFile(file, "not a directory", "utf8");

      await expect(scanStagedWorkspace(file)).rejects.toThrow(/workspace\.tree-invalid/);
    });
  });
});
