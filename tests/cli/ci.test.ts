import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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
  it("preserves an explicitly supplied 0.1.0 GitHub Action package version", () => {
    const content = renderGitHubAction({ nodeVersion: "20", paths: [".agents/skills"], packageVersion: "0.1.0" });

    expect(content).toContain("contents: read");
    expect(content).toContain("npx --yes @chumanic/skillsync@0.1.0 verify --format sarif");
    expect(content).toContain("published @chumanic/skillsync@0.1.0");
    expect(content).toContain("github/codeql-action/upload-sarif@v4");
    expect(content).toContain(".agents/skills/**");
  });

  it("preserves an explicitly supplied 0.1.0 pre-commit package version", () => {
    const content = renderPreCommit({ paths: [".claude/skills", ".agents/skills"], packageVersion: "0.1.0" });

    expect(content).toContain("id: skillsync-verify");
    expect(content).toContain(".claude/skills");
    expect(content).toContain(".agents/skills");
    expect(content).toContain("npx --yes @chumanic/skillsync@0.1.0 verify --format json");
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
    expect(planned.content).toContain("@chumanic/skillsync@0.1.0 verify --format sarif");
    await expect(access(join(root, ".github/workflows/skillsync.yml"))).rejects.toThrow();

    const applied = await runCiInit({
      target: "github",
      nodeVersion: "20",
      paths: [".agents/skills"],
      cwd: root,
      apply: true,
    });
    expect(applied.applied).toBe(true);
    expect(await readFile(applied.outputPath, "utf8")).toContain("@chumanic/skillsync@0.1.0 verify --format sarif");

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

it('pins an explicit GitHub source commit and refuses ambiguous channels', async () => {
  const result = await runCiInit({target:'github',nodeVersion:'20',paths:['.agents/skills'],source:'github-source',sourceRevision:'a'.repeat(40)})
  expect(result.content).toMatch(/git -C "\$install_root" fetch --depth 1 https:\/\/github\.com\/Chumaniac\/skillsync\.git a{40}/)
  expect(result.content).toContain('capabilities --expect-source '+ 'a'.repeat(40))
  expect(result.content).toContain('npm ci --ignore-scripts')
  expect(result.content).not.toContain('npx --yes @chumanic/skillsync@')
  await expect(runCiInit({target:'github',nodeVersion:'20',paths:[],source:'github-source',sourceRevision:'main'})).rejects.toThrow(/40/)
  await expect(runCiInit({target:'pre-commit',nodeVersion:'20',paths:[],source:'github-source',sourceRevision:'a'.repeat(40)})).rejects.toThrow(/GitHub/)
})


it('two simultaneous apply requests publish one complete file and force refuses links', async () => {
  const root = await mkdtemp(join(tmpdir(),'skillsync-ci-race-'));
  const options = {target:'github' as const,nodeVersion:'20',paths:['.agents/skills'],cwd:root,apply:true};
  const results = await Promise.allSettled([runCiInit(options),runCiInit(options)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const path=join(root,'.github/workflows/skillsync.yml');
  expect(await readFile(path,'utf8')).toContain('@chumanic/skillsync@0.1.0 verify');
  const another=await mkdtemp(join(tmpdir(),'skillsync-ci-link-'));await mkdir(join(another,'.github/workflows'),{recursive:true});
  const outside=join(another,'preserve.txt');await writeFile(outside,'synthetic preserved content');await symlink(outside,join(another,'.github/workflows/skillsync.yml'));
  await expect(runCiInit({...options,cwd:another,force:true})).rejects.toThrow();
  expect(await readFile(outside,'utf8')).toBe('synthetic preserved content');
});
