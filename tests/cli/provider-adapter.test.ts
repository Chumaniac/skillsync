import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index";
import { runProviderAdapterValidate } from "../../src/cli/commands/provider-adapter";

const imageDigest = `sha256:${"a".repeat(64)}`;
const validManifest = {
  schema_version: 1,
  adapter_id: "reference",
  adapter_version: "1.0.0",
  provider: "reference-agent",
  provider_version: "0.1.0",
  image_digest: imageDigest,
  runner_protocol: "skillsync.runner.v1",
  runner_contract: "1",
  network: { mode: "deny" },
  credentials: { mode: "none", names: [] },
};
const validPolicy = {
  schema_version: 1,
  adapter_id: "reference",
  adapter_version: "1.0.0",
  provider: "reference-agent",
  provider_version: "0.1.0",
};

async function withManifest(
  value: unknown,
  run: (configPath: string, policyPath: string, policyDigest: string) => Promise<void>,
  policy = validPolicy,
) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-provider-adapter-cli-"));
  const path = join(root, "adapter.json");
  const policyPath = join(root, "policy.json");
  try {
    await writeFile(path, JSON.stringify(value), "utf8");
    await writeFile(policyPath, JSON.stringify(policy), "utf8");
    await run(path, policyPath, `sha256:${createHash("sha256").update(JSON.stringify(policy), "utf8").digest("hex")}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("skillsync runner adapter validate", () => {
  it("validates an offline adapter manifest", async () => {
    await withManifest(validManifest, async (configPath, policyPath, policyDigest) => {
      const report = await runProviderAdapterValidate({
        configPath,
        image: `skillsync/reference@${imageDigest}`,
        policyPath,
        policyDigest,
      });

      expect(report).toMatchObject({ status: "passed", exitCode: 0 });
      expect(report.findings).toEqual([{ code: "provider.adapter-valid", status: "pass" }]);
    });
  });

  it("rejects a manifest without an external immutable image binding", async () => {
    await withManifest(validManifest, async (configPath, _policyPath, _policyDigest) => {
      await expect(runProviderAdapterValidate({ configPath })).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringContaining("--image"),
      });
      await expect(runProviderAdapterValidate({ configPath, image: `skillsync/reference@${imageDigest}`, policyPath: undefined })).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringContaining("--policy"),
      });
    });
  });

  it("binds an adapter manifest to an external immutable image digest", async () => {
    await withManifest(validManifest, async (configPath, policyPath, policyDigest) => {
      const mismatch = await runProviderAdapterValidate({
        configPath,
        image: `skillsync/reference@sha256:${"b".repeat(64)}`,
        policyPath,
        policyDigest,
      });

      expect(mismatch.exitCode).toBe(1);
      expect(mismatch.findings[0]?.code).toBe("provider.image-mismatch");
    });
  });

  it("rejects adapter or provider drift against an external policy", async () => {
    await withManifest(validManifest, async (configPath, policyPath, policyDigest) => {
      const mismatch = await runProviderAdapterValidate({
        configPath,
        image: `skillsync/reference@${imageDigest}`,
        policyPath,
        policyDigest,
      });

      expect(mismatch.exitCode).toBe(1);
    }, { ...validPolicy, adapter_version: "2.0.0" });
  });

  it("rejects missing or ambiguous CLI input", async () => {
    const missing = await runCli(["runner", "adapter", "validate"]);
    const unknownImage = await runCli([
      "runner",
      "adapter",
      "validate",
      "--config",
      "adapter.json",
      "--image",
      "skillsync/reference:latest",
    ]);

    expect(missing.exitCode).toBe(2);
    expect(unknownImage.exitCode).toBe(2);
  });

  it("rejects a policy whose content is not externally bound", async () => {
    await withManifest(validManifest, async (configPath, policyPath) => {
      const mismatch = await runProviderAdapterValidate({
        configPath,
        image: `skillsync/reference@${imageDigest}`,
        policyPath,
        policyDigest: `sha256:${"b".repeat(64)}`,
      });

      expect(mismatch).toMatchObject({
        status: "failed",
        findings: [{ code: "provider.policy-digest-mismatch", status: "fail" }],
      });
    });
  });
});
