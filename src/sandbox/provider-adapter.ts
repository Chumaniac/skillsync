import { createHash } from "node:crypto";

import { z } from "zod";

const MAX_MANIFEST_BYTES = 64 * 1024;
const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(64);
const CredentialNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);

const CredentialsSchema = z
  .object({
    mode: z.enum(["none", "explicit-short-lived"]),
    names: z.array(CredentialNameSchema).max(16),
    max_ttl_seconds: z.number().int().positive().max(3_600).optional(),
  })
  .strict()
  .superRefine((credentials, context) => {
    if (credentials.mode === "none") {
      if (credentials.names.length > 0 || credentials.max_ttl_seconds !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "none credential mode cannot declare names or ttl" });
      }
    } else if (credentials.names.length === 0 || credentials.max_ttl_seconds === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "explicit credentials require names and ttl" });
    }
  });

const AdapterManifestSchema = z
  .object({
    schema_version: z.literal(1),
    adapter_id: IdentifierSchema,
    adapter_version: VersionSchema,
    provider: IdentifierSchema,
    provider_version: VersionSchema,
    image_digest: DigestSchema,
    runner_protocol: z.literal("skillsync.runner.v1"),
    runner_contract: z.literal("1"),
    network: z.object({ mode: z.enum(["deny", "proxy-required"]) }).strict(),
    credentials: CredentialsSchema,
  })
  .strict();

const AdapterPolicySchema = z
  .object({
    schema_version: z.literal(1),
    adapter_id: IdentifierSchema,
    adapter_version: VersionSchema,
    provider: IdentifierSchema,
    provider_version: VersionSchema,
  })
  .strict();

export type ProviderAdapterManifest = {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: string;
  provider: string;
  providerVersion: string;
  imageDigest: string;
  runnerProtocol: "skillsync.runner.v1";
  runnerContract: "1";
  network: { mode: "deny" | "proxy-required" };
  credentials: {
    mode: "none" | "explicit-short-lived";
    names: string[];
    maxTtlSeconds?: number;
  };
};

export class ProviderAdapterManifestError extends Error {
  readonly code = "provider.adapter-invalid" as const;

  constructor() {
    super("provider.adapter-invalid: Provider adapter manifest is invalid");
    this.name = "ProviderAdapterManifestError";
  }
}

export class ProviderAdapterPolicyError extends Error {
  readonly code = "provider.policy-invalid" as const;

  constructor() {
    super("provider.policy-invalid: Provider adapter policy is invalid");
    this.name = "ProviderAdapterPolicyError";
  }
}

export type ProviderAdapterPolicy = {
  adapterId: string;
  adapterVersion: string;
  provider: string;
  providerVersion: string;
  imageDigest: string;
  policyDigest: string;
};

export type ProviderAdapterIdentityPolicy = Omit<ProviderAdapterPolicy, "imageDigest">;

export type ProviderAdapterFinding =
  | {
      code: "provider.adapter-valid";
      status: "pass";
      message: "Provider adapter matches the conformance policy.";
    }
  | {
      code:
        | "provider.image-mismatch"
        | "provider.adapter-version-mismatch"
        | "provider.provider-mismatch"
        | "provider.provider-version-mismatch"
        | "provider.protocol-mismatch"
        | "provider.contract-mismatch"
        | "provider.policy-digest-mismatch";
      status: "fail";
      message: string;
    };

export function parseProviderAdapterManifest(content: string): ProviderAdapterManifest {
  if (Buffer.byteLength(content, "utf8") > MAX_MANIFEST_BYTES) {
    throw new ProviderAdapterManifestError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new ProviderAdapterManifestError();
  }
  const result = AdapterManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderAdapterManifestError();
  }
  const value = result.data;
  return {
    schemaVersion: value.schema_version,
    adapterId: value.adapter_id,
    adapterVersion: value.adapter_version,
    provider: value.provider,
    providerVersion: value.provider_version,
    imageDigest: value.image_digest,
    runnerProtocol: value.runner_protocol,
    runnerContract: value.runner_contract,
    network: value.network,
    credentials: {
      mode: value.credentials.mode,
      names: [...value.credentials.names],
      ...(value.credentials.max_ttl_seconds !== undefined
        ? { maxTtlSeconds: value.credentials.max_ttl_seconds }
        : {}),
    },
  };
}

export function parseProviderAdapterPolicy(content: string): ProviderAdapterIdentityPolicy {
  if (Buffer.byteLength(content, "utf8") > MAX_MANIFEST_BYTES) {
    throw new ProviderAdapterPolicyError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new ProviderAdapterPolicyError();
  }
  const result = AdapterPolicySchema.safeParse(parsed);
  if (!result.success) {
    throw new ProviderAdapterPolicyError();
  }
  return {
    adapterId: result.data.adapter_id,
    adapterVersion: result.data.adapter_version,
    provider: result.data.provider,
    providerVersion: result.data.provider_version,
    policyDigest: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
  };
}

function mismatch(
  code: Exclude<ProviderAdapterFinding["code"], "provider.adapter-valid">,
  message: string,
): ProviderAdapterFinding {
  return { code, status: "fail", message };
}

export function verifyProviderAdapter(
  manifest: ProviderAdapterManifest,
  policy: ProviderAdapterPolicy,
): ProviderAdapterFinding {
  if (manifest.imageDigest !== policy.imageDigest) {
    return mismatch("provider.image-mismatch", "Provider adapter image digest does not match the policy.");
  }
  if (manifest.adapterId !== policy.adapterId || manifest.adapterVersion !== policy.adapterVersion) {
    return mismatch("provider.adapter-version-mismatch", "Provider adapter identity or version does not match the policy.");
  }
  if (manifest.provider !== policy.provider) {
    return mismatch("provider.provider-mismatch", "Provider identity does not match the policy.");
  }
  if (manifest.providerVersion !== policy.providerVersion) {
    return mismatch("provider.provider-version-mismatch", "Provider version does not match the policy.");
  }
  if (manifest.runnerProtocol !== "skillsync.runner.v1") {
    return mismatch("provider.protocol-mismatch", "Provider adapter does not emit the required Runner protocol.");
  }
  if (manifest.runnerContract !== "1") {
    return mismatch("provider.contract-mismatch", "Provider adapter does not satisfy the required Runner contract.");
  }
  return {
    code: "provider.adapter-valid",
    status: "pass",
    message: "Provider adapter matches the conformance policy.",
  };
}
