import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArtifactContract } from "../../src/domain/artifact-contract.js";
import { createArtifactReconciliationIndex } from "../../src/domain/artifact-reconciliation.js";

function contract() {
  return parseArtifactContract(JSON.parse(readFileSync("fixtures/product/tenant-reconciliation/contract.json", "utf8")));
}

const row = (tenant: string, order: string, cents: number) => new Map<string, string | number>([["tenant_id", tenant], ["order_id", order], ["amount_cents", cents]]);

describe("opt-in private-value-free CSV record evidence", () => {
  it("locates split-group defects using actual record positions without exposing identities or amounts", () => {
    const index = createArtifactReconciliationIndex(contract(), { rowEvidence: true });
    const expected = index.observer("expected.csv")!, actual = index.observer("allocations.csv")!;
    expected(row("PRIVATE_ORG", "PRIVATE_ID", 1000), 2);
    actual(row("PRIVATE_ORG", "PRIVATE_ID", 500), 2);
    actual(row("PRIVATE_ORG", "PRIVATE_ID", 600), 4);
    const result = index.finish();
    expect(result.summaries[0]).toMatchObject({ status: "failed", valueMismatches: 1,
      recordEvidence: { items: [{ kind: "value_mismatch", sourceRows: [2], targetRows: [2, 4],
        sourceRowsTruncated: false, targetRowsTruncated: false }], total: 1, truncated: false } });
    expect(JSON.stringify(result).includes("PRIVATE_ORG")).toBe(false);
    expect(JSON.stringify(result).includes("PRIVATE_ID")).toBe(false);
    expect(JSON.stringify(result).includes("1000")).toBe(false);
    expect(index.finish()).toEqual(result);
  });

  it("does not change default report shapes or fabricate positions", () => {
    const original = createArtifactReconciliationIndex(contract());
    original.observer("expected.csv")!(row("A", "B", 1), 2);
    original.observer("allocations.csv")!(row("A", "B", 2), 2);
    expect(original.finish().summaries[0]).not.toHaveProperty("recordEvidence");
    const index = createArtifactReconciliationIndex(contract(), { rowEvidence: true });
    index.observer("expected.csv")!(row("A", "B", 1), 0);
    index.observer("allocations.csv")!(row("A", "B", 2), 0);
    expect(index.finish().summaries[0]).toMatchObject({ recordEvidence: { items: [], total: 1, truncated: true } });
  });

  it("caps row references and defect examples while preserving full counts", () => {
    const index = createArtifactReconciliationIndex(contract(), { rowEvidence: true });
    const expected = index.observer("expected.csv")!, actual = index.observer("allocations.csv")!;
    for (let i = 0; i < 70; i++) {
      expected(row("T", String(i), 1), i + 2);
      for (let n = 0; n < 10; n++) actual(row("T", String(i), 1), i * 10 + n + 2);
    }
    const summary = index.finish().summaries[0];
    expect(summary.valueMismatches).toBe(70);
    expect(summary.recordEvidence?.items).toHaveLength(32);
    expect(summary.recordEvidence?.items[0].targetRows).toHaveLength(8);
    expect(summary.recordEvidence).toMatchObject({ total: 70, truncated: true });
    expect(summary.recordEvidence?.items[0].targetRowsTruncated).toBe(true);
  });

  it("drops record evidence for invalid or exhausted observations", () => {
    const index = createArtifactReconciliationIndex(contract(), { rowEvidence: true });
    index.observer("expected.csv")!(row("T", "O", 1), 2);
    index.invalidate("allocations.csv");
    const result = index.finish();
    expect(result.summaries[0].status).toBe("unknown");
    expect(result.summaries[0]).not.toHaveProperty("recordEvidence");
    const exhausted = createArtifactReconciliationIndex(contract(), { rowEvidence: true });
    const observe = exhausted.observer("expected.csv")!;
    for (let i = 1; i < 33_335; i++) observe(row("T", "O", 0), i);
    expect(exhausted.finish().findings).toContainEqual({ code: "artifact.reconciliation-capacity" });
    expect(exhausted.finish().summaries[0]).not.toHaveProperty("recordEvidence");
  });

  it("locates missing and unexpected groups without exposing their keys", () => {
    const index = createArtifactReconciliationIndex(contract(), { rowEvidence: true });
    index.observer("expected.csv")!(row("T", "REQUIRED_PRIVATE", 1), 2);
    index.observer("allocations.csv")!(row("T", "EXTRA_PRIVATE", 1), 3);
    const result = index.finish();
    expect(result.summaries[0].recordEvidence?.items).toMatchObject([
      { kind: "missing", sourceRows: [2], targetRows: [] },
      { kind: "unexpected", sourceRows: [], targetRows: [3] },
    ]);
    expect(JSON.stringify(result).includes("REQUIRED_PRIVATE")).toBe(false);
    expect(JSON.stringify(result).includes("EXTRA_PRIVATE")).toBe(false);
  });

  it("bounds total retained examples across multiple declared checks", () => {
    const value = contract();
    const check = value.checks.find(item => item.type === "keyed_integer_sum_equals")!;
    value.checks = [check, check, check];
    const index = createArtifactReconciliationIndex(value, { rowEvidence: true });
    for (let i = 1; i <= 40; i++) {
      index.observer("expected.csv")!(row("T", String(i), 1), i);
      index.observer("allocations.csv")!(row("T", String(i), 2), i);
    }
    const results = index.finish().summaries;
    expect(results.reduce((total, item) => total + (item.recordEvidence?.items.length ?? 0), 0)).toBe(64);
    expect(results.every(item => item.valueMismatches === 40 && item.recordEvidence?.truncated)).toBe(true);
    expect(results[2].recordEvidence?.items).toEqual([]);
  });
});
