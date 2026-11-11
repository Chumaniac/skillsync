import { RUNNER_EVENT_LIMITS } from "../domain/runner-events.js";

export const RUNNER_ENTRYPOINT = "/usr/local/bin/skillsync-runner" as const;
export const RUNNER_CONTRACT_VERSION = "1" as const;
const REQUIRED_PATH = "/usr/local/bin:/usr/bin:/bin";
const SAFE_STATIC_ENV_NAMES = new Set(["PATH", "LANG", "LC_ALL", "TZ"]);
const FORBIDDEN_STATIC_ENV_NAMES = new Set([
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "DOCKER_HOST",
  "SSH_AUTH_SOCK",
]);

export type RunnerImageConfig = {
  labels: Record<string, string>;
  entrypoint: string[];
  env: string[];
};

export class RunnerImageContractError extends Error {
  readonly code = "image-contract-invalid" as const;

  constructor() {
    super("image-contract-invalid: Runner image Config is incompatible");
    this.name = "RunnerImageContractError";
  }
}

function invalid(): never {
  throw new RunnerImageContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return invalid();
  }
  return [...value];
}

function labels(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return invalid();
  }
  const entries = Object.entries(value);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    return invalid();
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function validateStaticEnvironment(entries: readonly string[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      return invalid();
    }
    const name = entry.slice(0, separator);
    const upperName = name.toUpperCase();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || names.has(name)) {
      return invalid();
    }
    names.add(name);
    if (
      FORBIDDEN_STATIC_ENV_NAMES.has(upperName) ||
      /^(AWS_|OPENAI_|ANTHROPIC_)/.test(upperName) ||
      /(TOKEN|KEY|SECRET|PASSWORD)/.test(upperName) ||
      !SAFE_STATIC_ENV_NAMES.has(name)
    ) {
      return invalid();
    }
  }

  const pathEntries = entries.filter((entry) => entry.startsWith("PATH="));
  if (pathEntries.length !== 1 || pathEntries[0] !== `PATH=${REQUIRED_PATH}`) {
    return invalid();
  }
  return [...entries];
}

export function parseRunnerImageConfig(content: string): RunnerImageConfig {
  if (Buffer.byteLength(content, "utf8") > RUNNER_EVENT_LIMITS.maxTotalBytes) {
    return invalid();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return invalid();
  }
  if (!isRecord(parsed)) {
    return invalid();
  }

  const parsedLabels = labels(parsed.Labels);
  const parsedEntrypoint = stringArray(parsed.Entrypoint);
  const parsedEnvironment = stringArray(parsed.Env);
  if (
    parsedLabels["org.skillsync.runner.protocol"] !== "skillsync.runner.v1" ||
    parsedLabels["org.skillsync.runner.contract"] !== RUNNER_CONTRACT_VERSION ||
    parsedLabels["org.skillsync.runner.entrypoint"] !== RUNNER_ENTRYPOINT ||
    parsedEntrypoint.length !== 1 ||
    parsedEntrypoint[0] !== RUNNER_ENTRYPOINT
  ) {
    return invalid();
  }

  return {
    labels: parsedLabels,
    entrypoint: parsedEntrypoint,
    env: validateStaticEnvironment(parsedEnvironment),
  };
}
