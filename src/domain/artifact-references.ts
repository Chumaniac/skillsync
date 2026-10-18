import { createHash } from "node:crypto";
import type { ArtifactContract } from "./artifact-contract.js";
import type { ArtifactCellObserver, ArtifactFinding, ArtifactRowObserver } from "./artifact-content.js";

export const MAX_REFERENCE_CELLS = 100_000;
const MAX_REFERENCE_HASH_BYTES = 64 * 1024 * 1024;
type Index = { targets?: Map<string, number>; sources?: Array<{ digest: string; row: number }>; referenced?: Set<string> };

/** One invocation-local index: declared fields only, hashed IDs, fixed aggregate ceiling. */
export function createArtifactReferenceIndex(contract: ArtifactContract) {
  const checks = contract.checks.filter(check => check.type === "reference_exists");
  const fields = new Map<string, Map<string, Index>>();
  const metadata = checks.map(() => ({ source: new Map<number, string>(), target: new Map<number, string>() }));
  const bindings = new Map<string, Array<{ check: number; side: "source" | "target" }>>();
  const index = (path: string, field: string): Index => {
    let columns = fields.get(path);
    if (!columns) { columns = new Map(); fields.set(path, columns); }
    let result = columns.get(field);
    if (!result) { result = {}; columns.set(field, result); }
    return result;
  };
  for (const check of checks) {
    index(check.source.path, check.source.field).sources ??= [];
    index(check.target.path, check.target.field).targets ??= new Map();
    if (check.require_all_targets) index(check.source.path, check.source.field).referenced ??= new Set();
  }
  checks.forEach((check, position) => {
    if (!check.matches) return;
    for (const side of ["source", "target"] as const) {
      const path = check[side].path;
      const roles = bindings.get(path) ?? [];
      roles.push({ check: position, side }); bindings.set(path, roles);
    }
  });
  let cells = 0, hashBytes = 0, exhausted = false;
  const charge = (count: number, bytes = 0): boolean => {
    cells += count; hashBytes += bytes;
    if (cells <= MAX_REFERENCE_CELLS && hashBytes <= MAX_REFERENCE_HASH_BYTES) return true;
    exhausted = true;
    for (const columns of fields.values()) for (const entry of columns.values()) {
      entry.targets?.clear(); entry.referenced?.clear(); if (entry.sources) entry.sources.length = 0;
    }
    for (const entry of metadata) { entry.source.clear(); entry.target.clear(); }
    return false;
  };
  return {
    observer(path: string): ArtifactCellObserver | undefined {
      const columns = fields.get(path);
      if (!columns) return undefined;
      return (field, value, row) => {
        const entry = columns.get(field);
        if (!entry || exhausted) return;
        // Repeated IDs count too. Stop hashing and release retained indexes at the ceiling.
        if (!charge(1, Buffer.byteLength(value))) return;
        const digest = createHash("sha256").update("skillsync.references/v1\0string\0").update(value).digest("hex");
        if (entry.targets && !entry.targets.has(digest)) entry.targets.set(digest, row);
        entry.sources?.push({ digest, row }); entry.referenced?.add(digest);
      };
    },
    rowObserver(path: string): ArtifactRowObserver | undefined {
      const roles = bindings.get(path);
      if (!roles) return undefined;
      return (values, row) => {
        if (exhausted || row === undefined) return;
        for (const role of roles) {
          const pairs = checks[role.check].matches!;
          if (!charge(pairs.length)) return;
          const tuple = pairs.map(pair => values.get(pair[role.side]));
          // Invalid cells never become a fabricated matching value.
          if (!tuple.every((value): value is string => typeof value === "string" && value.length > 0)) continue;
          const hasher = createHash("sha256").update("skillsync.reference-values/v1\0");
          for (const value of tuple) {
            const bytes = Buffer.byteLength(value);
            if (!charge(0, bytes)) return;
            // Length framing keeps tuples exact without copying repeated large values.
            hasher.update(String(bytes)).update("\0").update(value);
          }
          metadata[role.check][role.side].set(row, hasher.digest("hex"));
        }
      };
    },
    findings(): ArtifactFinding[] {
      if (exhausted) return [{ code: "artifact.reference-capacity" }];
      const findings: ArtifactFinding[] = [];
      for (const [position, check] of checks.entries()) {
        const targets = index(check.target.path, check.target.field).targets!;
        for (const source of index(check.source.path, check.source.field).sources!) {
          if (!targets.has(source.digest)) {
            findings.push({ code: "artifact.reference-missing", path: check.source.path, field: check.source.field, row: source.row });
            if (findings.length >= 256) return findings;
          } else if (check.matches) {
            const sourceValue = metadata[position].source.get(source.row);
            const targetValue = metadata[position].target.get(targets.get(source.digest)!);
            const unavailable = sourceValue === undefined || targetValue === undefined;
            if (unavailable || sourceValue !== targetValue) {
              findings.push({ code: unavailable ? "artifact.reference-value-unavailable" : "artifact.reference-value-mismatch",
                path: check.source.path, field: check.matches.map(pair => pair.source), row: source.row });
              if (findings.length >= 256) return findings;
            }
          }
        }
        if (check.require_all_targets) {
          const referenced = index(check.source.path, check.source.field).referenced!;
          for (const [digest, row] of targets) {
            if (!referenced.has(digest)) {
              findings.push({ code: "artifact.reference-unused", path: check.target.path, field: check.target.field, row });
              if (findings.length >= 256) return findings;
            }
          }
        }
      }
      return findings;
    },
  };
}
