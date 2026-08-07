import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import { publicAvailabilityFinding } from "../../src/cli/commands/test-v2";

async function createFixture(
  root: string,
  manifest: string,
  skillDocument = "---\nname: review\ndescription: Review a change.\n---\n",
): Promise<string> {
  const fixtureRoot = join(root, "fixture");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, "behavior.yaml"), manifest);
  await writeFile(join(fixtureRoot, "SKILL.md"), skillDocument);
  return fixtureRoot;
}

function replayManifest(): string {
  return [
    "schema_version: 2",
    "id: replay-basic",
    "description: Replay a bounded review output.",
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
    "  allowed_writes:",
    "    - workspace/review.md",
    "  required_outputs:",
    "    - workspace/review.md",
    "  forbidden_paths:",
    "    - /Users/**",
    "  allowed_tools: []",
  ].join("\n") + "\n";
}

function dockerManifest(): string {
  return replayManifest()
    .replace("id: replay-basic", "id: docker-unavailable")
    .replace("  backend: replay\n  replay_trace: events.jsonl\n", "  backend: docker\n  image: ghcr.io/skillsync/runner@sha256:" + "a".repeat(64) + "\n")
    .replace("skill_path: skill", "skill_path: skill");
}

function replayTrace(): string {
  return [
    {
      protocol: "skillsync.runner.v1",
      runId: "__SKILLSYNC_RUN_ID__",
      seq: 0,
      atMs: 0,
      type: "run.started",
      payload: { agent: "codex", skillPath: "skill", inputDigest: "__SKILLSYNC_INPUT_DIGEST__" },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: "__SKILLSYNC_RUN_ID__",
      seq: 1,
      atMs: 1,
      type: "fs.write",
      payload: { path: "workspace/review.md", bytes: 12, digest: "sha256:" + "b".repeat(64) },
    },
    {
      protocol: "skillsync.runner.v1",
      runId: "__SKILLSYNC_RUN_ID__",
      seq: 2,
      atMs: 2,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

async function createV2Fixture(root: string, backend: "replay" | "docker" = "replay"): Promise<string> {
  const fixtureRoot = join(root, backend === "replay" ? "replay-fixture" : "docker-fixture");
  await mkdir(join(fixtureRoot, "skill"), { recursive: true });
  await writeFile(join(fixtureRoot, "behavior.yaml"), backend === "replay" ? replayManifest() : dockerManifest());
  await writeFile(
    join(fixtureRoot, "skill", "SKILL.md"),
    "---\nname: replay\ndescription: Replay fixture\n---\n",
  );
  if (backend === "replay") {
    await writeFile(join(fixtureRoot, "events.jsonl"), replayTrace());
  }
  return fixtureRoot;
}

describe("skillsync test", () => {
  it("maps Runner image contract failures separately from runtime unavailability", () => {
    expect(publicAvailabilityFinding("image-contract-invalid")).toBe("sandbox.image-contract-invalid");
    expect(publicAvailabilityFinding("runtime-missing")).toBe("sandbox.backend-unavailable");
    expect(publicAvailabilityFinding(undefined)).toBe("sandbox.backend-unavailable");
  });

  it("preflights a fixture without executing it", async () => {
    const result = await runCli([
      "test",
      "--fixture",
      "fixtures/behavior/review-basic",
      "--agent",
      "codex",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      status: string;
      execution: string;
      agent?: string;
      findings: Array<{ code: string; status: string }>;
    };
    expect(report.status).toBe("preflight-pass");
    expect(report.execution).toBe("not-run");
    expect(report.agent).toBe("codex");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "behavior.required-file", status: "pass" }),
        expect.objectContaining({ code: "behavior.execution-not-run", status: "not-run" }),
      ]),
    );
  });

  it("lists behavior fixtures", async () => {
    const result = await runCli(["test", "--list", "--format", "json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).fixtures).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "review-basic" })]),
    );
  });

  it("fails when a required file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-missing-"));
    const fixtureRoot = await createFixture(
      root,
      [
        "schema_version: 1",
        "id: missing-reference",
        "description: A fixture with a missing required resource.",
        "required_files:",
        "  - SKILL.md",
        "  - references/missing.md",
      ].join("\n") + "\n",
    );

    const result = await runCli(["test", "--fixture", fixtureRoot, "--format", "json"]);

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      status: string;
      findings: Array<{ code: string; status: string }>;
    };
    expect(report.status).toBe("preflight-fail");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "behavior.required-file", status: "fail" }),
      ]),
    );
  });

  it("rejects fixture path traversal before scanning", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-boundary-"));
    const fixtureRoot = await createFixture(
      root,
      [
        "schema_version: 1",
        "id: traversal",
        "description: A fixture that attempts to escape its root.",
        "skill_path: ../outside",
      ].join("\n") + "\n",
    );

    const result = await runCli(["test", "--fixture", fixtureRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/outside|traversal|relative/i);
  });

  it("fails when a forbidden path is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-forbidden-"));
    const fixtureRoot = await createFixture(
      root,
      [
        "schema_version: 1",
        "id: forbidden-path",
        "description: A fixture with a forbidden resource.",
        "forbidden_paths:",
        "  - secrets",
      ].join("\n") + "\n",
    );
    await mkdir(join(fixtureRoot, "secrets"), { recursive: true });
    await writeFile(join(fixtureRoot, "secrets", "token.txt"), "fixture-only");

    const result = await runCli(["test", "--fixture", fixtureRoot, "--format", "json"]);

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout) as {
      findings: Array<{ code: string; status: string }>;
    };
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "behavior.forbidden-path", status: "fail" }),
      ]),
    );
  });

  it("rejects unknown manifest keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-schema-"));
    const fixtureRoot = await createFixture(
      root,
      [
        "schema_version: 1",
        "id: unknown-key",
        "description: A fixture with an unknown key.",
        "unexpected: true",
      ].join("\n") + "\n",
    );

    const result = await runCli(["test", "--fixture", fixtureRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Invalid behavior fixture|unrecognized|unknown/i);
  });

  it("rejects using --fixture and --list together", async () => {
    const result = await runCli([
      "test",
      "--fixture",
      "fixtures/behavior/review-basic",
      "--list",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/either|both|fixture|list/i);
  });

  it("preflights a v2 fixture without executing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-v2-preflight-"));
    const fixtureRoot = await createV2Fixture(root);
    const result = await runCli(["test", "--fixture", fixtureRoot, "--format", "json"]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      schema_version: number;
      preflight: { status: string };
      execution: { status: string; reason?: string };
    };
    expect(report.schema_version).toBe(2);
    expect(report.preflight.status).toBe("passed");
    expect(report.execution).toMatchObject({ status: "not-run", reason: "execute-flag-required" });
  });

  it("executes a v2 fixture through Replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-v2-replay-"));
    const fixtureRoot = await createV2Fixture(root);
    const result = await runCli([
      "test",
      "--fixture",
      fixtureRoot,
      "--execute",
      "--backend",
      "replay",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as {
      execution: { status: string; backend: string; evidence: { redacted: boolean } };
    };
    expect(report.execution.status).toBe("passed");
    expect(report.execution.backend).toBe("replay");
    expect(report.execution.evidence.redacted).toBe(true);
  });

  it("rejects missing backend, v1 execution, and backend mismatches with code 2", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-v2-errors-"));
    const replayFixture = await createV2Fixture(root);
    const dockerFixture = await createV2Fixture(root, "docker");

    const missingBackend = await runCli(["test", "--fixture", replayFixture, "--execute"]);
    const v1Execution = await runCli([
      "test",
      "--fixture",
      "fixtures/behavior/review-basic",
      "--execute",
      "--backend",
      "replay",
    ]);
    const mismatch = await runCli([
      "test",
      "--fixture",
      replayFixture,
      "--execute",
      "--backend",
      "docker",
    ]);

    expect(missingBackend.exitCode).toBe(2);
    expect(v1Execution.exitCode).toBe(2);
    expect(mismatch.exitCode).toBe(2);
    expect(dockerFixture).toContain("docker-fixture");
  });

  it("blocks Docker explicitly without fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-v2-docker-"));
    const fixtureRoot = await createV2Fixture(root, "docker");
    const result = await runCli([
      "test",
      "--fixture",
      fixtureRoot,
      "--execute",
      "--backend",
      "docker",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toMatch(/sandbox\.backend-unavailable/);
    expect(JSON.parse(result.stdout).execution.status).toBe("blocked");
  });

  it("returns code 2 for an invalid v2 manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-behavior-v2-invalid-"));
    const fixtureRoot = await createV2Fixture(root);
    await writeFile(join(fixtureRoot, "behavior.yaml"), `${replayManifest()}unexpected: true\n`);

    const result = await runCli(["test", "--fixture", fixtureRoot]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Invalid behavior fixture|unexpected|unknown/i);
  });
});
