import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import {
  runRunnerValidate,
  type RunnerValidateOptions,
} from "../../src/cli/commands/runner";
import type { ProcessResult, ProcessSpec, CommandRunner } from "../../src/sandbox/command";
import { RUNNER_ENTRYPOINT } from "../../src/sandbox/runner-contract";

const image = `skillsync/reference@sha256:${"a".repeat(64)}`;

const validConfig = {
  Labels: {
    "org.skillsync.runner.protocol": "skillsync.runner.v1",
    "org.skillsync.runner.contract": "1",
    "org.skillsync.runner.entrypoint": RUNNER_ENTRYPOINT,
  },
  Entrypoint: [RUNNER_ENTRYPOINT],
  Env: ["PATH=/usr/local/bin:/usr/bin:/bin"],
};

function result(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify(validConfig),
    stderr: "",
    timedOut: false,
    outputLimitExceeded: false,
    ...overrides,
  };
}

class FakeRunner implements CommandRunner {
  readonly calls: ProcessSpec[] = [];

  async run(spec: ProcessSpec): Promise<ProcessResult> {
    this.calls.push(spec);
    return result();
  }
}

async function withConfig(config: unknown, run: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-runner-validate-test-"));
  const path = join(root, "config.json");
  try {
    await writeFile(path, JSON.stringify(config), "utf8");
    await run(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withProvenance(run: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-runner-provenance-test-"));
  const path = join(root, "provenance.json");
  try {
    await writeFile(path, JSON.stringify({
      schema_version: 1,
      image_digest: `sha256:${"a".repeat(64)}`,
      runner_protocol: "skillsync.runner.v1",
      runner_contract: "1",
      builder: "trusted-builder",
      source: "trusted-source",
    }), "utf8");
    await run(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("skillsync runner validate", () => {
  it("accepts a valid offline Config file", async () => {
    await withConfig(validConfig, async (configPath) => {
      const report = await runRunnerValidate({ configPath });

      expect(report).toMatchObject({ status: "passed", exitCode: 0, source: "config" });
      expect(report.findings).toEqual([{ code: "runner.contract-valid", status: "pass" }]);
    });
  });

  it("returns a redacted failure for an invalid Config file", async () => {
    await withConfig({ ...validConfig, Env: ["OPENAI_API_KEY=secret"] }, async (configPath) => {
      const report = await runRunnerValidate({ configPath });

      expect(report).toMatchObject({ status: "failed", exitCode: 1 });
      expect(report.findings[0]?.code).toBe("runner.contract-invalid");
      expect(JSON.stringify(report)).not.toContain("secret");
    });
  });

  it("validates a local immutable image without ever pulling it", async () => {
    const runner = new FakeRunner();
    const report = await runRunnerValidate({ image, runner } satisfies RunnerValidateOptions);

    expect(report).toMatchObject({ status: "passed", exitCode: 0, source: "image", image });
    expect(report.findings.map((finding) => finding.code)).toEqual([
      "runner.contract-valid",
      "runner.provenance-not-requested",
    ]);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toEqual([
      "image",
      "inspect",
      "--format",
      "{{json .Config}}",
      image,
    ]);
    expect(runner.calls[0]?.args).not.toContain("pull");
  });

  it("binds optional provenance to the exact image digest", async () => {
    await withProvenance(async (provenancePath) => {
      const report = await runRunnerValidate({
        image,
        provenancePath,
        requireProvenance: true,
        trustedBuilders: ["trusted-builder"],
        trustedSources: ["trusted-source"],
        runner: new FakeRunner(),
      });

      expect(report.status).toBe("passed");
      expect(report.findings.map((finding) => finding.code)).toEqual([
        "runner.contract-valid",
        "runner.provenance-valid",
      ]);
    });
  });

  it("fails closed when signature verification is required but unavailable", async () => {
    await withProvenance(async (provenancePath) => {
      const report = await runRunnerValidate({
        image,
        provenancePath,
        requireSignature: true,
        runner: new FakeRunner(),
      });

      expect(report.exitCode).toBe(1);
      expect(report.findings.map((finding) => finding.code)).toContain("runner.signature-verification-unavailable");
    });
  });

  it("rejects ambiguous or mutable command input", async () => {
    const none = await runCli(["runner", "validate"]);
    const both = await runCli(["runner", "validate", "--config", "a", "--image", image]);
    const mutable = await runCli(["runner", "validate", "--image", "skillsync/reference:latest"]);

    expect(none.exitCode).toBe(2);
    expect(both.exitCode).toBe(2);
    expect(mutable.exitCode).toBe(2);
  });
});
