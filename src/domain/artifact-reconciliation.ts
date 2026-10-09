import { createHash } from "node:crypto";
import type { ArtifactContract } from "./artifact-contract.js";
import type { ArtifactFinding, ArtifactRowObserver } from "./artifact-content.js";

export const RECONCILIATION_CELL_LIMIT = 100_000;
type Check = Extract<ArtifactContract["checks"][number], { type: "keyed_integer_sum_equals" }>;
type Side = Check["source"];
type Group = { sums: Map<string, number>; overflow: boolean; invalid: boolean };
export type ReconciliationSummary = Check & {
  status: "passed" | "failed" | "unknown";
  sourceKeys?: number; targetKeys?: number; missingKeys?: number;
  unexpectedKeys?: number; valueMismatches?: number;
};

export function createArtifactReconciliationIndex(contract: ArtifactContract) {
  const checks = contract.checks.filter((check): check is Check => check.type === "keyed_integer_sum_equals");
  const groups = new Map<string, Group>();
  const byPath = new Map<string, Array<{ side: Side; group: Group }>>();
  const identity = (side: Side) => JSON.stringify([side.path, side.key, side.value]);
  for (const check of checks) for (const side of [check.source, check.target]) {
    const id = identity(side);
    if (groups.has(id)) continue;
    const group: Group = { sums: new Map(), overflow: false, invalid: false };
    groups.set(id, group);
    const entries = byPath.get(side.path) ?? [];
    entries.push({ side, group }); byPath.set(side.path, entries);
  }
  let observedCells = 0, exhausted = false;
  let completed: { summaries: ReconciliationSummary[]; findings: ArtifactFinding[] } | undefined;
  const release = () => { for (const group of groups.values()) group.sums.clear(); };
  return {
    observer(path: string): ArtifactRowObserver | undefined {
      const entries = byPath.get(path);
      if (!entries) return undefined;
      return values => {
        if (completed) throw new Error("reconciliation index is closed");
        if (exhausted) return;
        // Hash each selected key field once per row; raw IDs never enter the index.
        const fingerprints = new Map<string, string>();
        for (const { side, group } of entries) {
          if (group.invalid || group.overflow) continue;
          const key = values.get(side.key), value = values.get(side.value);
          if (typeof key !== "string" || !key.length || typeof value !== "number" || !Number.isSafeInteger(value)) {
            group.invalid = true; group.sums.clear(); continue;
          }
          observedCells += 2;
          if (observedCells > RECONCILIATION_CELL_LIMIT) { exhausted = true; release(); return; }
          let fingerprint = fingerprints.get(side.key);
          if (!fingerprint) {
            fingerprint = createHash("sha256").update(key).digest("hex");
            fingerprints.set(side.key, fingerprint);
          }
          const sum = (group.sums.get(fingerprint) ?? 0) + value;
          if (!Number.isSafeInteger(sum)) { group.overflow = true; group.sums.clear(); }
          else group.sums.set(fingerprint, sum);
        }
      };
    },
    invalidate(path: string) {
      if (completed) throw new Error("reconciliation index is closed");
      for (const { group } of byPath.get(path) ?? []) { group.invalid = true; group.sums.clear(); }
    },
    finish(): { summaries: ReconciliationSummary[]; findings: ArtifactFinding[] } {
      if (completed) return completed;
      const summaries: ReconciliationSummary[] = [], findings: ArtifactFinding[] = [];
      if (exhausted) findings.push({ code: "artifact.reconciliation-capacity" });
      for (const check of checks) {
        const source = groups.get(identity(check.source))!, target = groups.get(identity(check.target))!;
        if (exhausted || source.invalid || target.invalid || source.overflow || target.overflow) {
          summaries.push({ ...check, status: "unknown" });
          if (!exhausted) findings.push({ code: source.overflow || target.overflow
            ? "artifact.reconciliation-unsafe-sum" : "artifact.reconciliation-unavailable",
          path: check.target.path, field: check.target.value });
          continue;
        }
        let missingKeys = 0, unexpectedKeys = 0, valueMismatches = 0;
        for (const [key, value] of source.sums) {
          if (!target.sums.has(key)) missingKeys += 1;
          else if (target.sums.get(key) !== value) valueMismatches += 1;
        }
        for (const key of target.sums.keys()) if (!source.sums.has(key)) unexpectedKeys += 1;
        if (missingKeys || unexpectedKeys) findings.push({ code: "artifact.reconciliation-keys", path: check.target.path, field: check.target.key });
        if (valueMismatches) findings.push({ code: "artifact.reconciliation-sum", path: check.target.path, field: check.target.value });
        summaries.push({ ...check, status: missingKeys || unexpectedKeys || valueMismatches ? "failed" : "passed",
          sourceKeys: source.sums.size, targetKeys: target.sums.size, missingKeys, unexpectedKeys, valueMismatches });
      }
      // Reports retain only declared metadata and counts, never the per-key index.
      release();
      completed = { summaries, findings: findings.slice(0, 256) };
      return completed;
    },
  };
}
