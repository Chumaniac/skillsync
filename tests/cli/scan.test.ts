import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";

describe("skillsync scan", () => {
  it("emits a JSON inventory for an explicit path", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-scan-"));
    const skillRoot = join(root, "review");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: review\n---\n");

    const result = await runCli(["scan", "--path", root, "--format", "json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      skills: Array<{ name: string; digest: string }>;
    };
    expect(report.skills).toHaveLength(1);
    expect(report.skills[0]?.name).toBe("review");
    expect(report.skills[0]?.digest).toMatch(/^sha256:/);
    expect(result.stdout).not.toContain(root);
    expect(report.skills[0]).toHaveProperty("rootPath", "<local-path>");
    expect(report.skills[0]).toHaveProperty("skillMdPath", "<local-path>");
  });
});
