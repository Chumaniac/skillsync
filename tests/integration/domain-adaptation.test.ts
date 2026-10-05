import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import { renderBehaviorTest, type BehaviorTestReport } from "../../src/cli/commands/test";
import type { BehaviorExecutionReport } from "../../src/domain/behavior-execution";

const roots: string[] = [];

async function copyFixture(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillsync-domain-"));
  roots.push(root);
  const fixture = join(root, name);
  await cp(join("fixtures/behavior", name), fixture, { recursive: true });
  return fixture;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("domain adaptation fixtures", () => {
  it("redacts local paths in fixture listings for JSON and text", () => {
    const localRoot = join(tmpdir(), "skillsync-synthetic-paths");
    const report = {
      schema_version: 1 as const,
      fixtures: [{ id: "domain-code-review", path: join(localRoot, "materials"), description: `Reference at ${join(localRoot, "source.diff")}` }],
    };
    for (const format of ["json", "text"]) {
      const rendered = renderBehaviorTest(report, format);
      expect(rendered).not.toContain(localRoot);
      expect(rendered).toContain("<local-path>");
      expect(rendered).toContain("domain-code-review");
    }
  });

  it.each(["domain-code-review", "domain-knowledge-reference"])(
    "%s checks materials without executing an Agent",
    async (name) => {
      const fixture = await copyFixture(name);
      const result = await runCli(["test", "--fixture", fixture, "--agent", "codex", "--format", "json"]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout) as BehaviorTestReport;
      expect(report.status).toBe("preflight-pass");
      expect(report.execution).toBe("not-run");
      expect(result.stdout).not.toContain(fixture);
    },
  );

  it.each([
    ["domain-code-review", "references/change.diff"],
    ["domain-knowledge-reference", "references/source.md"],
  ])("%s rejects a missing required reference", async (name, missing) => {
    const fixture = await copyFixture(name);
    await rm(join(fixture, "skill", missing));
    const result = await runCli(["test", "--fixture", fixture, "--format", "json"]);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as BehaviorTestReport;
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "behavior.required-file", status: "fail" }));
  });

  it("rejects a private material folder", async () => {
    const fixture = await copyFixture("domain-knowledge-reference");
    await mkdir(join(fixture, "skill/private"));
    await writeFile(join(fixture, "skill/private/synthetic.txt"), "synthetic private fixture");
    const result = await runCli(["test", "--fixture", fixture, "--format", "json"]);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as BehaviorTestReport;
    expect(report.execution).toBe("not-run");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "behavior.forbidden-path", status: "fail" }));
  });

  it("preflights the data contract and only replays it when explicitly requested", async () => {
    const fixture = await copyFixture("domain-data-export");
    const before = await runCli(["test", "--fixture", fixture, "--format", "json"]);
    expect(before.exitCode).toBe(0);
    expect((JSON.parse(before.stdout) as BehaviorExecutionReport).execution.status).toBe("not-run");
    const result = await runCli(["test", "--fixture", fixture, "--execute", "--backend", "replay", "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as BehaviorExecutionReport;
    expect(report.preflight.status).toBe("passed");
    expect(report.execution.status).toBe("passed");
    expect(report.execution.backend).toBe("replay");
    expect(report.execution.evidence.writes).toContainEqual(expect.objectContaining({ path: "workspace/export.csv" }));
  });

  it("rejects an undeclared write in the synthetic data trace", async () => {
    const fixture = await copyFixture("domain-data-export");
    const path = join(fixture, "events.jsonl");
    await writeFile(path, (await readFile(path, "utf8")).replace("workspace/export.csv", "workspace/undeclared.csv"));
    const result = await runCli(["test", "--fixture", fixture, "--execute", "--backend", "replay", "--format", "json"]);
    expect(result.exitCode).not.toBe(0);
    const report = JSON.parse(result.stdout) as BehaviorExecutionReport;
    expect(report.execution.status).toBe("failed");
    expect(report.execution.findings).toContainEqual(expect.objectContaining({ code: "invariant.write-forbidden", status: "fail" }));
  });
});
