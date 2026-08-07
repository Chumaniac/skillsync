import { describe, expect, it } from "vitest";

import {
  parseRunnerProvenance,
  verifyRunnerProvenance,
  type RunnerProvenancePolicy,
} from "../../src/sandbox/runner-provenance";

const imageDigest = `sha256:${"a".repeat(64)}`;
const validContent = JSON.stringify({
  schema_version: 1,
  image_digest: imageDigest,
  runner_protocol: "skillsync.runner.v1",
  runner_contract: "1",
  builder: "github.com/skillsync/reference",
  source: "github.com/skillsync/skillsync@refs/heads/main",
  signature: { scheme: "cosign", reference: "oci://ghcr.io/skillsync/reference" },
});

const policy: RunnerProvenancePolicy = {
  imageDigest,
  runnerProtocol: "skillsync.runner.v1",
  runnerContract: "1",
  trustedBuilders: ["github.com/skillsync/reference"],
  trustedSources: ["github.com/skillsync/skillsync@refs/heads/main"],
};

describe("Runner provenance", () => {
  it("parses bounded strict provenance metadata", () => {
    expect(parseRunnerProvenance(validContent)).toMatchObject({
      imageDigest,
      builder: "github.com/skillsync/reference",
      signature: { scheme: "cosign" },
    });
  });

  it.each([
    ["unknown key", { extra: "not allowed" }],
    ["wrong digest", { image_digest: "sha256:broken" }],
    ["missing builder", { builder: undefined }],
  ])("rejects %s without exposing attestation contents", (_label, override) => {
    const value = JSON.parse(validContent) as Record<string, unknown>;
    for (const [key, entry] of Object.entries(override)) {
      if (entry === undefined) {
        delete value[key];
      } else {
        value[key] = entry;
      }
    }

    expect(() => parseRunnerProvenance(JSON.stringify(value))).toThrow(/runner\.provenance-invalid/);
    try {
      parseRunnerProvenance(JSON.stringify(value));
    } catch (error: unknown) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain("not allowed");
    }
  });

  it("requires exact image, contract, builder, and source matches", () => {
    const provenance = parseRunnerProvenance(validContent);

    expect(verifyRunnerProvenance(provenance, policy)).toEqual({
      code: "runner.provenance-valid",
      status: "pass",
      message: "Runner provenance matches the local policy.",
    });
    expect(verifyRunnerProvenance(provenance, { ...policy, imageDigest: `sha256:${"b".repeat(64)}` }).code)
      .toBe("runner.provenance-digest-mismatch");
    expect(verifyRunnerProvenance(provenance, { ...policy, trustedBuilders: ["other-builder"] }).code)
      .toBe("runner.provenance-untrusted-builder");
  });

  it("does not claim signature verification when no approved verifier exists", () => {
    const provenance = parseRunnerProvenance(validContent);

    expect(verifyRunnerProvenance(provenance, { ...policy, requireSignature: true })).toEqual({
      code: "runner.signature-verification-unavailable",
      status: "fail",
      message: "Signature verification is required but no approved verifier is configured.",
    });
  });
});
