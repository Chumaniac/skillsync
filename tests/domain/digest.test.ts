import { describe, expect, it } from "vitest";

import {
  computeSkillDigest,
  normalizeRelativePath,
  type DigestFile,
} from "../../src/domain/digest";

function file(
  relativePath: string,
  content: string,
  overrides: Partial<DigestFile> = {},
): DigestFile {
  return {
    relativePath,
    content: Buffer.from(content),
    mode: 0o644,
    isSymlink: false,
    ...overrides,
  };
}

describe("computeSkillDigest", () => {
  it("is stable across input order and filesystem metadata changes", () => {
    const first = [
      { ...file("SKILL.md", "name: review"), mtimeMs: 100, inode: 1 },
      { ...file("references/guide.md", "guide"), mtimeMs: 100, inode: 2 },
    ];
    const second = [
      { ...file("references/guide.md", "guide"), mtimeMs: 999, inode: 22 },
      { ...file("SKILL.md", "name: review"), mtimeMs: 999, inode: 11 },
    ];

    expect(computeSkillDigest(first)).toBe(computeSkillDigest(second));
  });

  it("changes when file content changes", () => {
    const original = [file("SKILL.md", "description: first")];
    const changed = [file("SKILL.md", "description: second")];

    expect(computeSkillDigest(original)).not.toBe(computeSkillDigest(changed));
  });

  it("includes symlink metadata instead of treating a link as a regular file", () => {
    const regularFile = [file("references/guide.md", "../outside.md")];
    const symlink = [
      file("references/guide.md", "../outside.md", { isSymlink: true }),
    ];

    expect(computeSkillDigest(regularFile)).not.toBe(computeSkillDigest(symlink));
  });

  it("rejects traversal and absolute paths before hashing", () => {
    expect(() => normalizeRelativePath("../outside.md")).toThrow(/path traversal/i);
    expect(() => normalizeRelativePath("nested/../../outside.md")).toThrow(
      /path traversal/i,
    );
    expect(() => normalizeRelativePath("/etc/passwd")).toThrow(/absolute/i);
    expect(() => normalizeRelativePath("C:\\outside.md")).toThrow(/absolute/i);
  });

  it("normalizes separators and rejects duplicate normalized paths", () => {
    expect(normalizeRelativePath("./references\\guide.md")).toBe(
      "references/guide.md",
    );
    expect(() =>
      computeSkillDigest([
        file("./SKILL.md", "one"),
        file("SKILL.md", "two"),
      ]),
    ).toThrow(/duplicate/i);
  });
});
