import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import {
  renderGitHubAction,
  renderPreCommit,
  runCiInit,
} from "../../src/cli/commands/ci";

describe("skillsync ci", () => {
  it("renders a read-only GitHub Action with SARIF upload", () => {
    const content = renderGitHubAction({ nodeVersion: "20", paths: [".agents/skills"], packageVersion: "0.1.0" });

    expect(content).toContain("contents: read");
    expect(content).toContain("npx --yes skillsync@0.1.0 verify --format sarif");
    expect(content).toContain("published skillsync@0.1.0");
    expect(content).toContain("upload-sarif");
    expect(content).toContain(".agents/skills/**");
  });

  it("renders a pre-commit hook for explicit Skill paths", () => {
    const content = renderPreCommit({ paths: [".claude/skills", ".agents/skills"], packageVersion: "0.1.0" });

    expect(content).toContain("id: skillsync-verify");
    expect(content).toContain(".claude/skills");
    expect(content).toContain(".agents/skills");
    expect(content).toContain("npx --yes skillsync@0.1.0 verify --format json");
  });

  it("prints a plan without writing, and applies only when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-ci-"));
    const planned = await runCiInit({
      target: "github",
      nodeVersion: "20",
      paths: [".agents/skills"],
      cwd: root,
    });
    expect(planned.applied).toBe(false);
    await expect(access(join(root, ".github/workflows/skillsync.yml"))).rejects.toThrow();

    const applied = await runCiInit({
      target: "github",
      nodeVersion: "20",
      paths: [".agents/skills"],
      cwd: root,
      apply: true,
    });
    expect(applied.applied).toBe(true);
    expect(await readFile(applied.outputPath, "utf8")).toContain("skillsync@0.1.0 verify --format sarif");

    await expect(
      runCiInit({
        target: "github",
        nodeVersion: "20",
        paths: [".agents/skills"],
        cwd: root,
        apply: true,
      }),
    ).rejects.toThrow(/force/i);
  });

  it("exposes ci init through the CLI in plan mode", async () => {
    const result = await runCli([
      "ci",
      "init",
      "--target",
      "github",
      "--node-version",
      "20",
      "--path",
      ".agents/skills",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("contents: read");
    expect(result.stdout).toContain("plan");
  });
});
