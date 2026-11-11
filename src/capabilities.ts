/** Declared source capabilities; none grants runtime, apply or export authority. */
export const CURRENT_CAPABILITIES = [
  "static-verification/v1", "sarif-report/v1", "junit-report/v1",
  "acceptance-batches/v1", "workbench-operation-tracking/v1",
  "scoped-operation-cancel/v1", "pinned-ci-source/v1",
] as const;
export const DEFAULT_NPM_VERSION = "0.1.0";
export const CHANNEL_OBSERVATION = {
  observedAt: "2026-11-06", npm: "0.1.0", githubRelease: "v0.3.0",
  liveCheckedByThisCommand: false,
};
