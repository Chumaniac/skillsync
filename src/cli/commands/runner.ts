import { readFile } from "node:fs/promises";

import {
  parseRunnerImageConfig,
  RunnerImageContractError,
} from "../../sandbox/runner-contract.js";
import {
  SpawnCommandRunner,
  type CommandRunner,
  type ProcessSpec,
} from "../../sandbox/command.js";
import {
  parseRunnerProvenance,
  RunnerProvenanceError,
  verifyRunnerProvenance,
} from "../../sandbox/runner-provenance.js";

const VALID_IMAGE_REFERENCE = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const VALIDATE_TIMEOUT_MS = 5_000;

export type RunnerValidationFinding = {
  code:
    | "runner.contract-valid"
    | "runner.contract-invalid"
    | "runner.image-unavailable"
    | "runner.config-unreadable"
    | "runner.provenance-valid"
    | "runner.provenance-not-requested"
    | "runner.provenance-missing"
    | "runner.provenance-invalid"
    | "runner.provenance-digest-mismatch"
    | "runner.provenance-protocol-mismatch"
    | "runner.provenance-contract-mismatch"
    | "runner.provenance-untrusted-builder"
    | "runner.provenance-untrusted-source"
    | "runner.signature-verification-unavailable";
  status: "pass" | "fail";
  message?: string;
};

export type RunnerValidationReport = {
  schema_version: 1;
  source: "config" | "image";
  status: "passed" | "failed";
  exitCode: 0 | 1;
  image?: string;
  findings: RunnerValidationFinding[];
};

export type RunnerValidateOptions = {
  configPath?: string;
  image?: string;
  provenancePath?: string;
  requireProvenance?: boolean;
  requireSignature?: boolean;
  trustedBuilders?: string[];
  trustedSources?: string[];
  dockerPath?: string;
  runner?: CommandRunner;
};

export class RunnerValidationCommandError extends Error {
  readonly exitCode = 2 as const;

  constructor(message: string) {
    super(message);
    this.name = "RunnerValidationCommandError";
  }
}

function validReport(source: RunnerValidationReport["source"], image?: string): RunnerValidationReport {
  return {
    schema_version: 1,
    source,
    status: "passed",
    exitCode: 0,
    ...(image ? { image } : {}),
    findings: [{ code: "runner.contract-valid", status: "pass" }],
  };
}

function failedReport(
  source: RunnerValidationReport["source"],
  finding: RunnerValidationFinding,
  image?: string,
): RunnerValidationReport {
  return {
    schema_version: 1,
    source,
    status: "failed",
    exitCode: 1,
    ...(image ? { image } : {}),
    findings: [finding],
  };
}

function withProvenance(
  report: RunnerValidationReport,
  finding: RunnerValidationFinding,
): RunnerValidationReport {
  if (finding.status === "pass") {
    return { ...report, findings: [...report.findings, finding] };
  }
  return { ...report, status: "failed", exitCode: 1, findings: [...report.findings, finding] };
}

async function validateProvenance(
  image: string,
  options: RunnerValidateOptions,
): Promise<RunnerValidationFinding> {
  if (!options.provenancePath) {
    return options.requireProvenance
      ? {
          code: "runner.provenance-missing",
          status: "fail",
          message: "Runner provenance is required but no attestation file was supplied.",
        }
      : {
          code: "runner.provenance-not-requested",
          status: "pass",
          message: "Runner provenance was not requested.",
        };
  }

  let content: string;
  try {
    content = await readFile(options.provenancePath, "utf8");
  } catch {
    return {
      code: "runner.provenance-invalid",
      status: "fail",
      message: "Runner provenance could not be read.",
    };
  }

  let provenance;
  try {
    provenance = parseRunnerProvenance(content);
  } catch (error: unknown) {
    if (!(error instanceof RunnerProvenanceError)) {
      throw error;
    }
    return {
      code: "runner.provenance-invalid",
      status: "fail",
      message: "Runner provenance does not satisfy the local attestation schema.",
    };
  }

  return verifyRunnerProvenance(provenance, {
    imageDigest: image.slice(image.lastIndexOf("@") + 1),
    runnerProtocol: "skillsync.runner.v1",
    runnerContract: "1",
    trustedBuilders: options.trustedBuilders,
    trustedSources: options.trustedSources,
    requireSignature: options.requireSignature,
  });
}

function validateConfig(content: string, source: RunnerValidationReport["source"], image?: string): RunnerValidationReport {
  try {
    parseRunnerImageConfig(content);
    return validReport(source, image);
  } catch (error: unknown) {
    if (!(error instanceof RunnerImageContractError)) {
      throw error;
    }
    return failedReport(source, {
      code: "runner.contract-invalid",
      status: "fail",
      message: "Runner image Config does not satisfy the SkillSync contract.",
    }, image);
  }
}

function imageInspectSpec(dockerPath: string, image: string): ProcessSpec {
  return {
    executable: dockerPath,
    args: ["image", "inspect", "--format", "{{json .Config}}", image],
    timeoutMs: VALIDATE_TIMEOUT_MS,
  };
}

export async function runRunnerValidate(options: RunnerValidateOptions): Promise<RunnerValidationReport> {
  const hasConfig = options.configPath !== undefined;
  const hasImage = options.image !== undefined;
  if (hasConfig === hasImage) {
    throw new RunnerValidationCommandError(
      "runner validate requires exactly one of --config <path> or --image <immutable-ref>",
    );
  }
  if (options.configPath && (options.provenancePath || options.requireProvenance || options.requireSignature)) {
    throw new RunnerValidationCommandError("Runner provenance checks require --image so the attestation can bind to an exact digest");
  }
  if (options.requireSignature && !options.provenancePath) {
    throw new RunnerValidationCommandError("--require-signature requires --provenance <path>");
  }

  if (options.image !== undefined) {
    if (!VALID_IMAGE_REFERENCE.test(options.image)) {
      throw new RunnerValidationCommandError("runner validate --image requires an immutable @sha256:<64 hex> reference");
    }
    const runner = options.runner ?? new SpawnCommandRunner();
    const inspected = await runner.run(imageInspectSpec(options.dockerPath ?? "docker", options.image));
    if (inspected.exitCode !== 0 || inspected.timedOut || inspected.outputLimitExceeded) {
      return failedReport("image", {
        code: "runner.image-unavailable",
        status: "fail",
        message: "The local Docker image could not be inspected.",
      }, options.image);
    }
    const report = validateConfig(inspected.stdout, "image", options.image);
    if (report.status === "failed") {
      return report;
    }
    return withProvenance(report, await validateProvenance(options.image, options));
  }

  let content: string;
  try {
    content = await readFile(options.configPath!, "utf8");
  } catch {
    return failedReport("config", {
      code: "runner.config-unreadable",
      status: "fail",
      message: "The Runner Config file could not be read.",
    });
  }
  return validateConfig(content, "config");
}

export function renderRunnerValidation(report: RunnerValidationReport, format = "text"): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  if (format !== "text") {
    throw new Error(`Unsupported runner validate output format: ${format}`);
  }
  const lines = [
    `Runner validation: ${report.status}`,
    `Source: ${report.source}`,
    ...report.findings.map((finding) => `- [${finding.status}] ${finding.code}${finding.message ? `: ${finding.message}` : ""}`),
    `Exit code: ${report.exitCode}`,
  ];
  return `${lines.join("\n")}\n`;
}
