import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const intentionallyBrokenMarkdownLinks = new Map<string, Set<string>>([
  [
    "fixtures/invalid/missing-reference/SKILL.md",
    new Set(["references/does-not-exist.md"]),
  ],
  [
    "fixtures/invalid/path-traversal/SKILL.md",
    new Set(["../outside.md"]),
  ],
]);

function trackedMarkdownFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
    encoding: "utf8",
  }).split("\0").filter(Boolean);
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function resolvedMarkdownTarget(file: string, rawTarget: string): string | null {
  const target = rawTarget.trim();
  const canonicalTarget = target.split("#", 1)[0]?.trim() ?? "";
  const isExternal =
    canonicalTarget.startsWith("http://")
    || canonicalTarget.startsWith("https://")
    || canonicalTarget.startsWith("mailto:");

  if (!canonicalTarget || isExternal || canonicalTarget.startsWith("#")) {
    return null;
  }

  return resolve(dirname(file), canonicalTarget);
}

function canonicalMarkdownTarget(rawTarget: string): string {
  return rawTarget.trim().split("#", 1)[0]?.trim() ?? "";
}

function shouldSkipBrokenLink(file: string, rawTarget: string): boolean {
  // These two fixture links are intentional negative cases covered by
  // structure/verify tests; only the exact documented file+target pairs are exempt.
  return intentionallyBrokenMarkdownLinks.get(file)?.has(canonicalMarkdownTarget(rawTarget)) ?? false;
}

describe("English repository documentation", () => {
  it("skips only the exact known broken negative-fixture links", () => {
    expect(shouldSkipBrokenLink("fixtures/invalid/missing-reference/SKILL.md", "references/does-not-exist.md")).toBe(true);
    expect(shouldSkipBrokenLink("fixtures/invalid/path-traversal/SKILL.md", "../outside.md")).toBe(true);
    expect(shouldSkipBrokenLink("fixtures/invalid/missing-reference/SKILL.md", "references/another-guide.md")).toBe(false);
    expect(shouldSkipBrokenLink("fixtures/invalid/path-traversal/SKILL.md", "../different-outside.md")).toBe(false);
  });

  it("contains no Han characters in tracked Markdown", async () => {
    for (const file of trackedMarkdownFiles()) {
      const source = await readFile(file, "utf8");
      const match = /\p{Script=Han}/u.exec(source);

      if (match?.index !== undefined) {
        throw new Error(`${file}:${lineNumber(source, match.index)} contains a Han character`);
      }
    }
  });

  it("resolves repository-relative Markdown links", async () => {
    const brokenLinks: string[] = [];

    for (const file of trackedMarkdownFiles()) {
      const source = await readFile(file, "utf8");

      for (const match of source.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
        const rawTarget = match[1];

        if (!rawTarget || match.index === undefined) {
          continue;
        }

        const targetPath = resolvedMarkdownTarget(file, rawTarget);

        if (!targetPath || shouldSkipBrokenLink(file, rawTarget) || existsSync(targetPath)) {
          continue;
        }

        brokenLinks.push(`${file}:${lineNumber(source, match.index)} -> ${rawTarget}`);
      }
    }

    expect(brokenLinks).toEqual([]);
  });
});
