import { createHash } from "node:crypto";
import type { ArtifactContract } from "./artifact-contract.js";
import type { ArtifactCellObserver, ArtifactFinding } from "./artifact-content.js";

export const MAX_REFERENCE_CELLS = 100_000;
type Index = { targets?: Map<string, number>; sources?: Array<{ digest: string; row: number }>; referenced?: Set<string> };

/** One invocation-local index: declared fields only, hashed IDs, fixed aggregate ceiling. */
export function createArtifactReferenceIndex(contract: ArtifactContract) {
  const checks = contract.checks.filter(check => check.type === "reference_exists");
  const fields = new Map<string, Map<string, Index>>();
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
  let cells = 0, exhausted = false;
  return {
    observer(path: string): ArtifactCellObserver | undefined {
      const columns = fields.get(path);
      if (!columns) return undefined;
      return (field, value, row) => {
        const entry = columns.get(field);
        if (!entry || exhausted) return;
        // Repeated IDs count too. Stop hashing and release retained indexes at the ceiling.
        cells += 1;
        if (cells > MAX_REFERENCE_CELLS) {
          exhausted = true;
          for (const columns of fields.values()) for (const entry of columns.values()) {
            entry.targets?.clear(); entry.referenced?.clear(); if (entry.sources) entry.sources.length = 0;
          }
          return;
        }
        const digest = createHash("sha256").update("skillsync.references/v1\0string\0").update(value).digest("hex");
        if (entry.targets && !entry.targets.has(digest)) entry.targets.set(digest, row);
        entry.sources?.push({ digest, row }); entry.referenced?.add(digest);
      };
    },
    findings(): ArtifactFinding[] {
      if (exhausted) return [{ code: "artifact.reference-capacity" }];
      const findings: ArtifactFinding[] = [];
      for (const check of checks) {
        const targets = index(check.target.path, check.target.field).targets!;
        for (const source of index(check.source.path, check.source.field).sources!) {
          if (!targets.has(source.digest)) {
            findings.push({ code: "artifact.reference-missing", path: check.source.path, field: check.source.field, row: source.row });
            if (findings.length >= 256) return findings;
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
