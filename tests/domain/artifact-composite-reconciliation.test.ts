import { describe, expect, it } from "vitest";
import { parseArtifactContract } from "../../src/domain/artifact-contract";
import { createArtifactReconciliationIndex, RECONCILIATION_CELL_LIMIT } from "../../src/domain/artifact-reconciliation";

function build(width: number) {
  const keys = Array.from({ length: width }, (_, index) => `key${index}`);
  return { keys, index: createArtifactReconciliationIndex(parseArtifactContract({ schema: "skillsync.artifacts/v1",
    limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
    files: ["source.csv", "target.csv"].map(path => ({ path, format: "csv", max_rows: 100_000,
      columns: [...keys.map(name => ({ name, type: "string" })), { name: "units", type: "integer" }] })),
    checks: [{ type: "keyed_integer_sum_equals", source: { path: "source.csv", key: keys, value: "units" },
      target: { path: "target.csv", key: keys, value: "units" } }],
  })) };
}

describe("composite key index bounds", () => {
  it.each([2, 3, 4])("counts all %i key components plus the integer value", width => {
    const { keys, index } = build(width);
    const values = new Map<string, string | number>([...keys.map(key => [key, "PRIVATE"] as [string, string]), ["units", 0]]);
    const observe = index.observer("source.csv")!;
    const rows = Math.floor(RECONCILIATION_CELL_LIMIT / (width + 1));
    for (let row = 0; row < rows; row += 1) observe(values);
    expect(index.finish().findings.some(finding => finding.code === "artifact.reconciliation-capacity")).toBe(false);
    expect(() => observe(values)).toThrow("closed");
    const overflow = build(width).index;
    for (let row = 0; row <= rows; row += 1) overflow.observer("source.csv")!(values);
    const finished = overflow.finish();
    expect(finished.findings).toContainEqual({ code: "artifact.reconciliation-capacity" });
    expect(finished.summaries[0]).toMatchObject({ status: "unknown" });
    expect(finished.summaries[0]).not.toHaveProperty("sourceKeys");
    expect(overflow.finish()).toEqual(finished);
  });

  it("does not accept a missing component as a smaller tuple", () => {
    const { index } = build(2);
    index.observer("source.csv")!(new Map<string, string | number>([["key0", "PRIVATE"], ["units", 0]]));
    expect(index.finish().summaries[0].status).toBe("unknown");
  });

  it("matches declared positional aliases without binding a tuple to column names", () => {
    const value = createArtifactReconciliationIndex(parseArtifactContract({ schema: "skillsync.artifacts/v1",
      limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
      files: [["source.csv", "organization", "order"], ["target.csv", "account", "ticket"]].map(([path, first, second]) => ({
        path, format: "csv", max_rows: 1, columns: [first, second].map(name => ({ name, type: "string" })).concat([{ name: "units", type: "integer" }]),
      })), checks: [{ type: "keyed_integer_sum_equals", source: { path: "source.csv", key: ["organization", "order"], value: "units" },
        target: { path: "target.csv", key: ["account", "ticket"], value: "units" } }],
    }));
    value.observer("source.csv")!(new Map<string, string | number>([["organization", "PRIVATE_A"], ["order", "0001"], ["units", 2]]));
    value.observer("target.csv")!(new Map<string, string | number>([["account", "PRIVATE_A"], ["ticket", "0001"], ["units", 2]]));
    expect(value.finish().summaries[0].status).toBe("passed");
  });
});
