import { readFile } from "node:fs/promises";

import {
  parseProviderAdapterManifest,
  parseProviderAdapterPolicy,
  ProviderAdapterManifestError,
  ProviderAdapterPolicyError,
  verifyProviderAdapter,
  type ProviderAdapterFinding,
} from "../../sandbox/provider-adapter.js";

const IMMUTABLE_IMAGE = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const POLICY_DIGEST = /^sha256:[0-9a-f]{64}$/;

export type ProviderAdapterValidationFinding = {
  code:
    | ProviderAdapterFinding["code"]
    | "provider.config-unreadable"
    | "provider.adapter-invalid"
    | "provider.policy-unreadable"
    | "provider.policy-invalid"
    | "provider.policy-digest-mismatch";
  status: "pass" | "fail";
  message?: string;
};

export type ProviderAdapterValidationReport = {
  schema_version: 1;
  status: "passed" | "failed";
  exitCode: 0 | 1;
  configPath: string;
  image?: string;
  findings: ProviderAdapterValidationFinding[];
};

export type ProviderAdapterValidateOptions = {
  configPath?: string;
  image?: string;
  policyPath?: string;
  policyDigest?: string;
};

export class ProviderAdapterCommandError extends Error {
  readonly exitCode = 2 as const;

  constructor(message: string) {
    super(message);
    this.name = "ProviderAdapterCommandError";
  }
}

function failed(
  configPath: string,
  code: ProviderAdapterValidationFinding["code"],
  message: string,
  image?: string,
): ProviderAdapterValidationReport {
  return {
    schema_version: 1,
    status: "failed",
    exitCode: 1,
    configPath,
    ...(image ? { image } : {}),
    findings: [{ code, status: "fail", message }],
  };
}

export async function runProviderAdapterValidate(
  options: ProviderAdapterValidateOptions,
): Promise<ProviderAdapterValidationReport> {
  if (!options.configPath) {
    throw new ProviderAdapterCommandError("runner adapter validate requires --config <path>");
  }
  if (!options.image) {
    throw new ProviderAdapterCommandError(
      "runner adapter validate requires an external --image <immutable-ref> binding",
    );
  }
  if (!options.policyPath) {
    throw new ProviderAdapterCommandError(
      "runner adapter validate requires an external --policy <path> identity binding",
    );
  }
  if (!options.policyDigest) {
    throw new ProviderAdapterCommandError(
      "runner adapter validate requires an external --policy-digest <sha256:...> binding",
    );
  }
  if (options.image && !IMMUTABLE_IMAGE.test(options.image)) {
    throw new ProviderAdapterCommandError("runner adapter validate --image requires an immutable @sha256:<64 hex> reference");
  }
  if (!POLICY_DIGEST.test(options.policyDigest)) {
    throw new ProviderAdapterCommandError("runner adapter validate --policy-digest requires sha256:<64 hex>");
  }

  let content: string;
  try {
    content = await readFile(options.configPath, "utf8");
  } catch {
    return failed(options.configPath, "provider.config-unreadable", "Provider adapter manifest could not be read.", options.image);
  }

  let manifest;
  try {
    manifest = parseProviderAdapterManifest(content);
  } catch (error: unknown) {
    if (!(error instanceof ProviderAdapterManifestError)) {
      throw error;
    }
    return failed(options.configPath, "provider.adapter-invalid", "Provider adapter manifest does not satisfy the conformance schema.", options.image);
  }

  let policyContent: string;
  try {
    policyContent = await readFile(options.policyPath, "utf8");
  } catch {
    return failed(options.configPath, "provider.policy-unreadable", "Provider adapter policy could not be read.", options.image);
  }

  let identityPolicy;
  try {
    identityPolicy = parseProviderAdapterPolicy(policyContent);
  } catch (error: unknown) {
    if (!(error instanceof ProviderAdapterPolicyError)) {
      throw error;
    }
    return failed(options.configPath, "provider.policy-invalid", "Provider adapter policy does not satisfy the identity schema.", options.image);
  }

  if (identityPolicy.policyDigest !== options.policyDigest) {
    return failed(
      options.configPath,
      "provider.policy-digest-mismatch",
      "Provider adapter policy does not match the externally bound policy digest.",
      options.image,
    );
  }

  const policy = {
    ...identityPolicy,
    imageDigest: options.image.slice(options.image.lastIndexOf("@") + 1),
  };
  const finding = verifyProviderAdapter(manifest, policy);
  const report: ProviderAdapterValidationReport = {
    schema_version: 1,
    status: finding.status === "pass" ? "passed" : "failed",
    exitCode: finding.status === "pass" ? 0 : 1,
    configPath: options.configPath,
    ...(options.image ? { image: options.image } : {}),
    findings: [finding.status === "pass" ? { code: finding.code, status: finding.status } : finding],
  };
  return report;
}

export function renderProviderAdapterValidation(
  report: ProviderAdapterValidationReport,
  format = "text",
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  if (format !== "text") {
    throw new Error(`Unsupported provider adapter output format: ${format}`);
  }
  const lines = [
    `Provider adapter validation: ${report.status}`,
    ...report.findings.map((finding) => `- [${finding.status}] ${finding.code}${finding.message ? `: ${finding.message}` : ""}`),
    `Exit code: ${report.exitCode}`,
  ];
  return `${lines.join("\n")}\n`;
}
