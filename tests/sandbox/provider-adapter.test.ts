import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  parseProviderAdapterManifest,
  parseProviderAdapterPolicy,
  verifyProviderAdapter,
  type ProviderAdapterPolicy,
} from "../../src/sandbox/provider-adapter";

const imageDigest = `sha256:${"a".repeat(64)}`;
const validContent = JSON.stringify({
  schema_version: 1,
  adapter_id: "reference",
  adapter_version: "1.2.3",
  provider: "reference-agent",
  provider_version: "0.1.0",
  image_digest: imageDigest,
  runner_protocol: "skillsync.runner.v1",
  runner_contract: "1",
  network: { mode: "deny" },
  credentials: { mode: "none", names: [] },
});
const policyContent = JSON.stringify({
  schema_version: 1,
  adapter_id: "reference",
  adapter_version: "1.2.3",
  provider: "reference-agent",
  provider_version: "0.1.0",
});
const policyDigest = `sha256:${createHash("sha256").update(policyContent, "utf8").digest("hex")}`;

const policy: ProviderAdapterPolicy = {
  adapterId: "reference",
  adapterVersion: "1.2.3",
  provider: "reference-agent",
  providerVersion: "0.1.0",
  imageDigest,
  policyDigest,
};

describe("provider adapter conformance", () => {
  it("parses a strict external identity policy", () => {
    expect(parseProviderAdapterPolicy(policyContent)).toEqual({
      adapterId: "reference",
      adapterVersion: "1.2.3",
      provider: "reference-agent",
      providerVersion: "0.1.0",
      policyDigest,
    });
  });

  it("rejects unknown identity policy fields", () => {
    expect(() => parseProviderAdapterPolicy(JSON.stringify({
      schema_version: 1,
      adapter_id: "reference",
      adapter_version: "1.2.3",
      provider: "reference-agent",
      provider_version: "0.1.0",
      image_digest: imageDigest,
    }))).toThrow(/provider\.policy-invalid/);
  });

  it("parses and verifies an inert adapter manifest", () => {
    const manifest = parseProviderAdapterManifest(validContent);

    expect(manifest).toMatchObject({
      adapterId: "reference",
      adapterVersion: "1.2.3",
      provider: "reference-agent",
      imageDigest,
      credentials: { mode: "none", names: [] },
    });
    expect(verifyProviderAdapter(manifest, policy)).toEqual({
      code: "provider.adapter-valid",
      status: "pass",
      message: "Provider adapter matches the conformance policy.",
    });
  });

  it("accepts only explicit credential names with a bounded short-lived policy", () => {
    const manifest = parseProviderAdapterManifest(validContent.replace(
      '"credentials":{"mode":"none","names":[]}',
      '"credentials":{"mode":"explicit-short-lived","names":["REFERENCE_API_KEY"],"max_ttl_seconds":900}',
    ));

    expect(manifest.credentials).toEqual({
      mode: "explicit-short-lived",
      names: ["REFERENCE_API_KEY"],
      maxTtlSeconds: 900,
    });
  });

  it.each([
    ["raw credential value", { credentials: { mode: "none", names: [], value: "secret" } }],
    ["missing explicit credential ttl", { credentials: { mode: "explicit-short-lived", names: ["REFERENCE_API_KEY"] } }],
    ["credential name with lowercase", { credentials: { mode: "explicit-short-lived", names: ["reference_key"], max_ttl_seconds: 900 } }],
    ["provider shell field", { shell: "/bin/sh" }],
  ])("rejects %s", (_label, override) => {
    const value = JSON.parse(validContent) as Record<string, unknown>;
    Object.assign(value, override);

    expect(() => parseProviderAdapterManifest(JSON.stringify(value))).toThrow(/provider\.adapter-invalid/);
  });

  it("rejects version, provider, and image identity drift", () => {
    const manifest = parseProviderAdapterManifest(validContent);

    expect(verifyProviderAdapter(manifest, { ...policy, imageDigest: `sha256:${"b".repeat(64)}` }).code)
      .toBe("provider.image-mismatch");
    expect(verifyProviderAdapter(manifest, { ...policy, adapterVersion: "1.2.4" }).code)
      .toBe("provider.adapter-version-mismatch");
    expect(verifyProviderAdapter(manifest, { ...policy, provider: "other-agent" }).code)
      .toBe("provider.provider-mismatch");
  });
});
