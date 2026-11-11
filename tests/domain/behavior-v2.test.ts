import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildRunSpec,
  computeBehaviorInputDigest,
  matchSandboxGlob,
} from "../../src/domain/behavior-v2";
import {
  parseBehaviorManifest,
  type BehaviorFixtureV2,
} from "../../src/domain/behavior-fixture";

const validReplayYaml = `
schema_version: 2
id: review-basic-v2
description: Review a bounded change in Replay.
skill_path: skill
agent: codex
execution:
  backend: replay
  replay_trace: events.jsonl
  timeout_ms: 30000
  memory_mb: 512
  cpu_limit: 1
  pids_limit: 64
  network:
    mode: deny
    allowed_hosts: []
  environment:
    allow: []
invariants:
  allowed_writes:
    - workspace/review.md
    - workspace/.skillsync/**
  required_outputs:
    - workspace/review.md
  forbidden_paths:
    - /Users/**
    - workspace/.secrets/**
  allowed_tools:
    - fs.read
    - fs.write
`;

function replaceYaml(source: string, from: string, to: string): string {
  return source.replace(from, to);
}

describe("behavior fixture v2", () => {
  it("accepts a Replay fixture with its conditional trace", () => {
    const fixture = parseBehaviorManifest(validReplayYaml, "behavior.yaml");

    expect(fixture).toMatchObject({
      schema_version: 2,
      id: "review-basic-v2",
      execution: { backend: "replay", replay_trace: "events.jsonl" },
    });
  });

  it.each([
    ["docker without image", replaceYaml(validReplayYaml, "backend: replay", "backend: docker")],
    ["replay without trace", validReplayYaml.replace("  replay_trace: events.jsonl\n", "")],
    [
      "docker with replay trace",
      replaceYaml(
        validReplayYaml,
        "backend: replay",
        "backend: docker\n  image: ghcr.io/skillsync/runner@sha256:" + "a".repeat(64),
      ),
    ],
    ["unknown execution key", `${validReplayYaml}\n  unexpected: true\n`],
    ["unsafe workspace path", validReplayYaml.replace("workspace/review.md", "../outside.md")],
    ["required output outside allowed writes", validReplayYaml.replace("workspace/review.md", "workspace/missing.md")],
  ])("rejects %s", (_label, yaml) => {
    expect(() => parseBehaviorManifest(yaml, "behavior.yaml")).toThrow(/Invalid behavior fixture/);
  });

  it("rejects inconsistent network modes and invalid limits", () => {
    const nonEmptyDenyHosts = validReplayYaml.replace(
      "    allowed_hosts: []",
      "    allowed_hosts:\n      - example.com",
    );
    const excessiveTimeout = validReplayYaml.replace("  timeout_ms: 30000", "  timeout_ms: 600001");

    expect(() => parseBehaviorManifest(nonEmptyDenyHosts, "behavior.yaml")).toThrow(
      /Invalid behavior fixture/,
    );
    expect(() => parseBehaviorManifest(excessiveTimeout, "behavior.yaml")).toThrow(
      /Invalid behavior fixture/,
    );
  });

  it("rejects unknown top-level and invariant keys", () => {
    expect(() => parseBehaviorManifest(`${validReplayYaml}\nunexpected: true\n`, "behavior.yaml"))
      .toThrow(/Invalid behavior fixture/);
    expect(() => parseBehaviorManifest(`${validReplayYaml}\n  allowed_processes: []\n`, "behavior.yaml"))
      .toThrow(/Invalid behavior fixture/);
  });
});

describe("behavior v2 paths and RunSpec", () => {
  it("matches only the documented single and recursive globs", () => {
    expect(matchSandboxGlob("workspace/review.md", "workspace/*.md")).toBe(true);
    expect(matchSandboxGlob("workspace/nested/review.md", "workspace/*.md")).toBe(false);
    expect(matchSandboxGlob("workspace/nested/review.md", "workspace/**")).toBe(true);
    expect(matchSandboxGlob("workspace/../outside.md", "workspace/**")).toBe(false);
  });

  it("builds a normalized Replay RunSpec inside the fixture root", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-v2-spec-"));
    await mkdir(join(root, "skill"), { recursive: true });
    await writeFile(join(root, "events.jsonl"), "");
    const manifest = parseBehaviorManifest(validReplayYaml, "behavior.yaml");

    expect(manifest.schema_version).toBe(2);
    const spec = buildRunSpec({
      fixtureRoot: root,
      manifest: manifest as BehaviorFixtureV2,
      stagedWorkspace: join(root, "stage"),
      runId: "run-1",
      inputDigest: "sha256:" + "b".repeat(64),
    });

    expect(spec.backend).toBe("replay");
    expect(spec.fixtureId).toBe("review-basic-v2");
    expect(spec.skillPath).toBe(join(root, "skill"));
    expect(spec.replayTracePath).toBe(join(root, "events.jsonl"));
    expect(spec.inputDigest).toBe("sha256:" + "b".repeat(64));
    expect(spec.invariants.requiredOutputs).toEqual(["workspace/review.md"]);
  });

  it("produces a stable digest independent of file ordering", () => {
    const manifest = parseBehaviorManifest(validReplayYaml, "behavior.yaml") as BehaviorFixtureV2;
    const files = [
      {
        relativePath: "references/guide.md",
        content: Buffer.from("guide"),
        mode: 0o644,
        isSymlink: false,
      },
      {
        relativePath: "SKILL.md",
        content: Buffer.from("skill"),
        mode: 0o644,
        isSymlink: false,
      },
    ];

    const first = computeBehaviorInputDigest(manifest, files);
    const second = computeBehaviorInputDigest(manifest, [...files].reverse());
    const changed = computeBehaviorInputDigest(manifest, [
      { ...files[0], content: Buffer.from("changed") },
      files[1],
    ]);

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});
