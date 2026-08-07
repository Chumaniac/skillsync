import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import {
  computeEventDigest,
  parseRunnerTrace,
  type RunnerEvent,
} from "../domain/runner-events.js";
import type {
  BackendAvailability,
  BackendExecutionResult,
  SandboxBackend,
  SandboxHandle,
  TeardownResult,
  VirtualFileObservation,
} from "./types.js";
import type { RunSpec } from "../domain/behavior-v2.js";

const RUN_ID_MARKER = "__SKILLSYNC_RUN_ID__";
const INPUT_DIGEST_MARKER = "__SKILLSYNC_INPUT_DIGEST__";

function finalFilesDigest(files: readonly VirtualFileObservation[]): string {
  const canonical = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

function bindTraceMarkers(content: string, spec: RunSpec): string {
  return content
    .replace(
      new RegExp(`(\\"runId\\"\\s*:\\s*)\\"${RUN_ID_MARKER}\\"`, "g"),
      `$1${JSON.stringify(spec.runId)}`,
    )
    .replace(
      new RegExp(`(\\"inputDigest\\"\\s*:\\s*)\\"${INPUT_DIGEST_MARKER}\\"`, "g"),
      `$1${JSON.stringify(spec.inputDigest)}`,
    );
}

function resultFor(
  events: readonly RunnerEvent[],
  finalFiles: readonly VirtualFileObservation[],
  overrides: Partial<BackendExecutionResult> = {},
): BackendExecutionResult {
  return {
    processExitCode: null,
    timedOut: false,
    protocolComplete: false,
    finalFiles: [...finalFiles],
    eventDigest: computeEventDigest(events),
    finalFilesDigest: finalFilesDigest(finalFiles),
    ...overrides,
  };
}

export class ReplayBackend implements SandboxBackend {
  readonly name = "replay" as const;

  async checkAvailable(spec: RunSpec): Promise<BackendAvailability> {
    if (spec.backend !== "replay" || !spec.replayTracePath) {
      return { available: false, reason: "runtime-missing" };
    }
    try {
      const metadata = await lstat(spec.replayTracePath);
      return metadata.isFile()
        ? { available: true }
        : { available: false, reason: "runtime-missing" };
    } catch {
      return { available: false, reason: "runtime-missing" };
    }
  }

  async provision(spec: RunSpec): Promise<SandboxHandle> {
    return {
      id: spec.runId,
      backend: "replay",
      runId: spec.runId,
      startedAt: new Date().toISOString(),
    };
  }

  async execute(
    handle: SandboxHandle,
    spec: RunSpec,
    onEvent: (event: RunnerEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<BackendExecutionResult> {
    if (handle.backend !== "replay" || handle.id !== spec.runId) {
      throw new Error("Replay handle does not match the requested RunSpec");
    }
    if (!spec.replayTracePath) {
      throw new Error("Replay execution requires replayTracePath");
    }

    const content = bindTraceMarkers(await readFile(spec.replayTracePath, "utf8"), spec);
    const parsed = parseRunnerTrace(content, {
      runId: spec.runId,
      inputDigest: spec.inputDigest,
    });
    const emitted: RunnerEvent[] = [];
    const files = new Map<string, VirtualFileObservation>();

    for (const event of parsed.events) {
      if (signal.aborted) {
        return resultFor(emitted, [...files.values()]);
      }
      emitted.push(event);
      if (event.type === "fs.write") {
        files.set(event.payload.path, {
          path: event.payload.path,
          bytes: event.payload.bytes,
          digest: event.payload.digest,
        });
      }
      await onEvent(event);
      if (signal.aborted) {
        return resultFor(emitted, [...files.values()]);
      }
    }

    return resultFor(emitted, [...files.values()], {
      processExitCode: parsed.terminalStatus === "passed" ? 0 : 1,
      protocolComplete: parsed.protocolComplete,
      eventDigest: parsed.eventDigest,
    });
  }

  async teardown(handle: SandboxHandle): Promise<TeardownResult> {
    return { completed: true, resourceId: handle.id };
  }
}
