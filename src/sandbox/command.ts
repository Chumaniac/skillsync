import { spawn } from "node:child_process";

import { RUNNER_EVENT_LIMITS } from "../domain/runner-events.js";

export type ProcessSpec = {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
};

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
};

export interface CommandRunner {
  run(spec: ProcessSpec): Promise<ProcessResult>;
}

const FIXED_COMMAND_PATH = "/usr/local/bin:/usr/bin:/bin";
const MAX_STDOUT_BYTES = RUNNER_EVENT_LIMITS.maxTotalBytes;
const MAX_STDERR_BYTES = RUNNER_EVENT_LIMITS.maxStderrBytes;

function emptyResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    outputLimitExceeded: false,
    ...overrides,
  };
}

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string {
  const remaining = maxBytes - Buffer.byteLength(current, "utf8");
  if (remaining <= 0) {
    return current;
  }
  return current + chunk.subarray(0, remaining).toString("utf8");
}

export class SpawnCommandRunner implements CommandRunner {
  async run(spec: ProcessSpec): Promise<ProcessResult> {
    if (spec.signal?.aborted) {
      return emptyResult({ timedOut: true });
    }

    return new Promise<ProcessResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let outputLimitExceeded = false;
      let settled = false;
      let onAbort: () => void = () => undefined;

      const child = spawn(spec.executable, [...spec.args], {
        shell: false,
        env: { PATH: FIXED_COMMAND_PATH },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stop = (reason: "timeout" | "abort" | "output"): void => {
        if (reason === "timeout" || reason === "abort") {
          timedOut = true;
        }
        if (reason === "output") {
          outputLimitExceeded = true;
        }
        child.kill("SIGKILL");
      };

      onAbort = (): void => stop("abort");
      if (spec.signal) {
        spec.signal.addEventListener("abort", onAbort, { once: true });
      }
      const timer = setTimeout(() => stop("timeout"), Math.max(1, spec.timeoutMs));

      const settle = (exitCode: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (spec.signal) {
          spec.signal.removeEventListener("abort", onAbort);
        }
        resolve({ exitCode, stdout, stderr, timedOut, outputLimitExceeded });
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES);
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          stop("output");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES);
        if (stderrBytes > MAX_STDERR_BYTES) {
          stop("output");
        }
      });
      child.once("error", (error: Error) => {
        stderr = appendBounded(stderr, Buffer.from(error.message), MAX_STDERR_BYTES);
        settle(null);
      });
      child.once("close", (exitCode) => settle(exitCode));
    });
  }
}
