import { createHash } from "node:crypto";
import type { ArtifactContract } from "./artifact-contract.js";
import type { ArtifactFinding, ArtifactRowObserver } from "./artifact-content.js";

export const RECONCILIATION_CELL_LIMIT = 100_000;
type Check = Extract<ArtifactContract["checks"][number], { type: "keyed_integer_sum_equals" }>;
type Side = Check["source"];
type Locations = { rows: number[]; total: number; unavailable: boolean };
type Group = { sums: Map<string, number>; overflow: boolean; invalid: boolean; rows?: Map<string, Locations> };
type Selection = { side: Side; group: Group; keys: string[]; keyIdentity: string };
export type RecordEvidence = { kind: "value_mismatch" | "missing" | "unexpected";
  sourceRows: number[]; targetRows: number[]; sourceRowsTruncated: boolean; targetRowsTruncated: boolean };
export type ReconciliationSummary = Check & {
  status: "passed" | "failed" | "unknown";
  sourceKeys?: number; targetKeys?: number; missingKeys?: number;
  unexpectedKeys?: number; valueMismatches?: number;
  recordEvidence?: { items: RecordEvidence[]; total: number; truncated: boolean };
};

export function createArtifactReconciliationIndex(contract: ArtifactContract, options: { rowEvidence?: boolean } = {}) {
  const checks = contract.checks.filter((check): check is Check => check.type === "keyed_integer_sum_equals");
  const groups = new Map<string, Group>();
  const byPath = new Map<string, Selection[]>();
  const identity = (side: Side) => JSON.stringify([side.path, side.key, side.value]);
  for (const check of checks) for (const side of [check.source, check.target]) {
    const id = identity(side);
    if (groups.has(id)) continue;
    const group: Group = { sums: new Map(), overflow: false, invalid: false, ...(options.rowEvidence ? { rows: new Map() } : {}) };
    groups.set(id, group);
    const entries = byPath.get(side.path) ?? [];
    const keys = typeof side.key === "string" ? [side.key] : side.key;
    entries.push({ side, group, keys, keyIdentity: JSON.stringify(keys) }); byPath.set(side.path, entries);
  }
  let observedCells = 0, exhausted = false;
  let completed: { summaries: ReconciliationSummary[]; findings: ArtifactFinding[] } | undefined;
  const clear = (group: Group) => { group.sums.clear(); group.rows?.clear(); };
  const release = () => { for (const group of groups.values()) clear(group); };
  return {
    observer(path: string): ArtifactRowObserver | undefined {
      const entries = byPath.get(path);
      if (!entries) return undefined;
      return (values, dataRecord) => {
        if (completed) throw new Error("reconciliation index is closed");
        if (exhausted) return;
        // Hash each selected key tuple once per row; raw IDs never enter the index.
        const fingerprints = new Map<string, string>();
        for (const { side, group, keys, keyIdentity } of entries) {
          if (group.invalid || group.overflow) continue;
          const components = keys.map(key => values.get(key));
          const value = values.get(side.value);
          if (!components.every((key): key is string => typeof key === "string" && key.length > 0) ||
              typeof value !== "number" || !Number.isSafeInteger(value)) {
            group.invalid = true; clear(group); continue;
          }
          observedCells += keys.length + 1;
          if (observedCells > RECONCILIATION_CELL_LIMIT) { exhausted = true; release(); return; }
          let fingerprint = fingerprints.get(keyIdentity);
          if (!fingerprint) {
            const hash = createHash("sha256");
            if (typeof side.key === "string") hash.update(components[0]);
            else {
              // Four components at most; frame UTF-8 lengths, never concatenate IDs.
              const length = Buffer.alloc(8);
              length.writeBigUInt64BE(BigInt(components.length));
              hash.update("skillsync.key-tuple/v1\0").update(length);
              for (const key of components) {
                length.writeBigUInt64BE(BigInt(Buffer.byteLength(key, "utf8")));
                hash.update(length).update(key);
              }
            }
            fingerprint = hash.digest("hex");
            fingerprints.set(keyIdentity, fingerprint);
          }
          const sum = (group.sums.get(fingerprint) ?? 0) + value;
          if (!Number.isSafeInteger(sum)) { group.overflow = true; clear(group); }
          else {
            group.sums.set(fingerprint, sum);
            if (group.rows) {
              const locations = group.rows.get(fingerprint) ?? { rows: [], total: 0, unavailable: false };
              locations.total += 1;
              if (dataRecord === undefined || !Number.isSafeInteger(dataRecord) || dataRecord < 1 || dataRecord > 100_000) locations.unavailable = true;
              else if (locations.rows.length < 8) locations.rows.push(dataRecord);
              group.rows.set(fingerprint, locations);
            }
          }
        }
      };
    },
    invalidate(path: string) {
      if (completed) throw new Error("reconciliation index is closed");
      for (const { group } of byPath.get(path) ?? []) { group.invalid = true; clear(group); }
    },
    finish(): { summaries: ReconciliationSummary[]; findings: ArtifactFinding[] } {
      if (completed) return completed;
      const summaries: ReconciliationSummary[] = [], findings: ArtifactFinding[] = [];
      let evidenceBudget = 64;
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
        const examples: RecordEvidence[] = [];
        const example = (kind: RecordEvidence["kind"], key: string) => {
          if (!options.rowEvidence || examples.length >= 32 || evidenceBudget === 0) return;
          const expected = source.rows?.get(key), delivered = target.rows?.get(key);
          if ((source.sums.has(key) && (!expected || expected.unavailable)) ||
              (target.sums.has(key) && (!delivered || delivered.unavailable))) return;
          examples.push({ kind, sourceRows: [...expected?.rows ?? []], targetRows: [...delivered?.rows ?? []],
            sourceRowsTruncated: Boolean(expected && expected.total > expected.rows.length),
            targetRowsTruncated: Boolean(delivered && delivered.total > delivered.rows.length) });
          evidenceBudget -= 1;
        };
        for (const [key, value] of source.sums) {
          if (!target.sums.has(key)) { missingKeys += 1; example("missing", key); }
          else if (target.sums.get(key) !== value) { valueMismatches += 1; example("value_mismatch", key); }
        }
        for (const key of target.sums.keys()) if (!source.sums.has(key)) { unexpectedKeys += 1; example("unexpected", key); }
        if (missingKeys || unexpectedKeys) findings.push({ code: "artifact.reconciliation-keys", path: check.target.path, field: check.target.key });
        if (valueMismatches) findings.push({ code: "artifact.reconciliation-sum", path: check.target.path, field: check.target.value });
        summaries.push({ ...check, status: missingKeys || unexpectedKeys || valueMismatches ? "failed" : "passed",
          sourceKeys: source.sums.size, targetKeys: target.sums.size, missingKeys, unexpectedKeys, valueMismatches,
          ...(options.rowEvidence ? { recordEvidence: { items: examples, total: missingKeys + unexpectedKeys + valueMismatches,
            truncated: examples.length < missingKeys + unexpectedKeys + valueMismatches } } : {}) });
      }
      // Reports retain only declared metadata and counts, never the per-key index.
      release();
      completed = { summaries, findings: findings.slice(0, 256) };
      return completed;
    },
  };
}
