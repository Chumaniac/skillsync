import { describe, expect, it } from "vitest";
import { parseArtifactContract } from "../../src/domain/artifact-contract";
import { createArtifactReconciliationIndex } from "../../src/domain/artifact-reconciliation";

function index() {
  return createArtifactReconciliationIndex(parseArtifactContract({ schema: "skillsync.artifacts/v1",
    limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
    files: ["source.csv", "target.csv"].map(path => ({ path, format: "csv", max_rows: 10,
      columns: [{ name: "id", type: "string" }, { name: "units", type: "integer" }] })),
    checks: [{ type: "keyed_integer_sum_equals", source: { path: "source.csv", key: "id", value: "units" },
      target: { path: "target.csv", key: "id", value: "units" } }],
  }));
}

describe("reconciliation index lifecycle", () => {
  it("keeps repeated finalization identical after releasing the key indexes", () => {
    const value = index();
    value.observer("source.csv")!(new Map<string, string | number>([["id", "PRIVATE"], ["units", 1]]));
    value.observer("target.csv")!(new Map<string, string | number>([["id", "PRIVATE"], ["units", 2]]));
    const first = value.finish();
    expect(first.summaries[0].status).toBe("failed");
    expect(value.finish()).toEqual(first);
    expect(() => value.observer("source.csv")!(new Map())).toThrow("closed");
  });

  it("does not turn missing or invalid observed values into empty-set success", () => {
    for (const units of [undefined, Number.NaN, 1.5, Infinity]) {
      const value = index();
      value.observer("source.csv")!(new Map<string, string | number>([["id", "PRIVATE"]]));
      if (units !== undefined) value.observer("target.csv")!(new Map<string, string | number>([["id", "PRIVATE"], ["units", units]]));
      expect(value.finish().summaries[0].status).toBe("unknown");
    }
  });
});
