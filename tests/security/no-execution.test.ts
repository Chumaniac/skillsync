import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import { runVerification } from "../../src/cli/commands/verify";
import { runScan } from "../../src/cli/commands/scan";

describe("no-execution boundary", () => {
  it("does not execute a bundled script during scan or verify", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-no-exec-"));
    const skillRoot = join(root, "dangerous");
    const marker = join(root, "executed.marker");
    await mkdir(join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: dangerous\ndescription: Contains a script fixture.\n---\n",
    );
    await writeFile(join(skillRoot, "scripts/write-marker.sh"), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });

    await runScan({ paths: [root] });
    await runVerification({ paths: [root], targets: ["codex"] });

    await expect(access(marker)).rejects.toThrow();
  });

  it("does not execute v2 fixture scripts during preflight or Docker blocking", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-no-exec-v2-"));
    const marker = join(root, "executed-v2.marker");
    const fixtureRoot = join(root, "fixture");
    await mkdir(join(fixtureRoot, "skill", "scripts"), { recursive: true });
    await writeFile(
      join(fixtureRoot, "skill", "SKILL.md"),
      "---\nname: v2-safe\ndescription: V2 boundary fixture\n---\n",
    );
    await writeFile(join(fixtureRoot, "skill", "scripts", "write-marker.sh"), `touch ${marker}\n`, {
      mode: 0o755,
    });
    await writeFile(join(fixtureRoot, "events.jsonl"), "{}\n");
    await writeFile(
      join(fixtureRoot, "behavior.yaml"),
      [
        "schema_version: 2",
        "id: v2-safe",
        "description: V2 boundary fixture.",
        "skill_path: skill",
        "agent: codex",
        "execution:",
        "  backend: replay",
        "  replay_trace: events.jsonl",
        "  timeout_ms: 30000",
        "  memory_mb: 512",
        "  cpu_limit: 1",
        "  pids_limit: 64",
        "  network:",
        "    mode: deny",
        "    allowed_hosts: []",
        "  environment:",
        "    allow: []",
        "invariants:",
        "  allowed_writes: [workspace/review.md]",
        "  required_outputs: [workspace/review.md]",
        "  forbidden_paths: [/Users/**]",
        "  allowed_tools: []",
      ].join("\n") + "\n",
    );

    const preflight = await runCli(["test", "--fixture", fixtureRoot]);
    const dockerBlocked = await runCli([
      "test",
      "--fixture",
      fixtureRoot,
      "--execute",
      "--backend",
      "docker",
    ]);

    expect(preflight.stdout + preflight.stderr).not.toContain("executed-v2.marker");
    expect(dockerBlocked.stdout + dockerBlocked.stderr).not.toContain("executed-v2.marker");
    await expect(access(marker)).rejects.toThrow();
  });
});
