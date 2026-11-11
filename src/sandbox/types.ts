import type { RunSpec } from "../domain/behavior-v2.js";
import type { RunnerEvent } from "../domain/runner-events.js";

export type BackendName = "replay" | "docker";

export type BackendAvailability = {
  available: boolean;
  reason?: "runtime-missing" | "image-missing" | "image-contract-invalid" | "unsupported-network-mode";
};

export type SandboxHandle = {
  id: string;
  backend: BackendName;
  runId: string;
  startedAt: string;
};

export type VirtualFileObservation = {
  path: string;
  bytes: number;
  digest: string;
};

export type WorkspaceTree = {
  files: VirtualFileObservation[];
  digest: string;
};

export type BackendExecutionResult = {
  processExitCode: number | null;
  timedOut: boolean;
  protocolComplete: boolean;
  finalFiles: VirtualFileObservation[];
  eventDigest: string;
  finalFilesDigest: string;
  workspaceTree?: WorkspaceTree;
  workspaceChanges?: VirtualFileObservation[];
  workspaceDeletedPaths?: string[];
};

export type TeardownResult = {
  completed: boolean;
  resourceId: string;
  errorCode?: string;
};

export interface SandboxBackend {
  readonly name: BackendName;
  checkAvailable(spec: RunSpec): Promise<BackendAvailability>;
  provision(spec: RunSpec): Promise<SandboxHandle>;
  execute(
    handle: SandboxHandle,
    spec: RunSpec,
    onEvent: (event: RunnerEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<BackendExecutionResult>;
  teardown(handle: SandboxHandle): Promise<TeardownResult>;
}
