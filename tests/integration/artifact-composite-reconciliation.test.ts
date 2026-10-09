import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { renderArtifacts, runArtifacts } from "../../src/cli/commands/artifacts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
type Row = [string, string, number];
const expected: Row[] = [["PRIVATE_ORG_A", "PRIVATE_001", 10], ["PRIVATE_ORG_B", "PRIVATE_001", 20]];
const split: Row[] = [["PRIVATE_ORG_A", "PRIVATE_001", 4], ["PRIVATE_ORG_B", "PRIVATE_001", 20], ["PRIVATE_ORG_A", "PRIVATE_001", 6]];

function declaration(sourceKey: string | string[] = ["tenant_id", "order_id"], targetKey = sourceKey) {
  return { schema: "skillsync.artifacts/v1", limits: { max_files: 3, max_file_bytes: 1_000_000, max_total_bytes: 3_000_000 },
    files: ["expected.csv", "actual.csv"].map(path => ({ path, format: "csv", max_rows: 1000,
      unique_by: path === "expected.csv" ? ["tenant_id", "order_id"] : [],
      columns: [{ name: "tenant_id", type: "string" }, { name: "order_id", type: "string" }, { name: "cents", type: "integer" }] })),
    checks: [{ type: "keyed_integer_sum_equals", source: { path: "expected.csv", key: sourceKey, value: "cents" },
      target: { path: "actual.csv", key: targetKey, value: "cents" } }],
  };
}

async function fixture(actual = split, contract = declaration(), source = expected) {
  const root = await mkdtemp(join(tmpdir(), "composite-artifacts-")); roots.push(root);
  const path = join(root, "data"); await mkdir(path);
  const csv = (rows: Row[]) => "tenant_id,order_id,cents\n" + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
  await writeFile(join(path, "expected.csv"), csv(source)); await writeFile(join(path, "actual.csv"), csv(actual));
  const contractPath = join(root, "contract.json"); await writeFile(contractPath, JSON.stringify(contract));
  return { root, path, contract: contractPath };
}

describe("composite delivery identities", () => {
  it("accepts split rows for organizations sharing a local order ID", async () => {
    const report = await runArtifacts(await fixture());
    expect(report.exitCode).toBe(0);
    expect(report.reconciliations?.[0]).toMatchObject({ status: "passed", sourceKeys: 2, targetKeys: 2, valueMismatches: 0 });
  });

  it("detects cross-organization shifts that a single local ID accepts", async () => {
    const wrong: Row[] = [["PRIVATE_ORG_A", "PRIVATE_001", 11], ["PRIVATE_ORG_B", "PRIVATE_001", 19]];
    expect((await runArtifacts(await fixture(wrong, declaration("order_id")))).exitCode).toBe(0);
    const report = await runArtifacts(await fixture(wrong));
    expect(report.exitCode).toBe(1);
    expect(report.reconciliations?.[0]).toMatchObject({ status: "failed", missingKeys: 0, unexpectedKeys: 0, valueMismatches: 2 });
    for (const format of ["json", "text"]) expect(renderArtifacts(report, format)).not.toContain("PRIVATE_");
  });

  it("frames values rather than joining ambiguous separators or adjacent strings", async () => {
    for (const source of [[ ["ab", "c", 10], ["a", "bc", 20] ], [ ["a|b", "c", 10], ["a", "b|c", 20] ]] as Row[][]) {
      const actual = source.map(([organization, id, cents]) => [organization, id, cents === 10 ? 20 : 10] as Row);
      const report = await runArtifacts(await fixture(actual, declaration(), source));
      expect(report.exitCode).toBe(1);
      expect(report.reconciliations?.[0]).toMatchObject({ sourceKeys: 2, targetKeys: 2, valueMismatches: 2 });
    }
  });

  it("preserves tuple order and exact spelling with structured field diagnostics", async () => {
    const report = await runArtifacts(await fixture(split, declaration(["tenant_id", "order_id"], ["order_id", "tenant_id"])));
    expect(report.exitCode).toBe(1);
    expect(report.findings).toContainEqual({ code: "artifact.reconciliation-keys", path: "actual.csv", field: ["order_id", "tenant_id"] });
    expect(renderArtifacts(report, "text")).toContain('field=["order_id","tenant_id"]');
    for (const replacement of ["PRIVATE_org_A", " PRIVATE_ORG_A", "PRIVATE_ORG_A "]) {
      const changed = split.map(row => [...row] as Row); changed[0][0] = replacement;
      expect((await runArtifacts(await fixture(changed))).exitCode).toBe(1);
    }
  });

  it("keeps invalid components and unsafe per-tuple sums unknown", async () => {
    const empty = split.map(row => [...row] as Row); empty[0][0] = "";
    expect((await runArtifacts(await fixture(empty))).reconciliations?.[0].status).toBe("unknown");
    const max = Number.MAX_SAFE_INTEGER;
    const source: Row[] = [["A", "I", max], ["B", "I", -max]];
    const actual: Row[] = [...source, ["A", "I", 1], ["B", "I", -1]];
    const report = await runArtifacts(await fixture(actual, declaration(), source));
    expect(report.exitCode).toBe(1);
    expect(report.reconciliations?.[0].status).toBe("unknown");
    expect(report.findings.some(item => item.code === "artifact.reconciliation-unsafe-sum")).toBe(true);
  });

  it("does not normalize Unicode or numeric-looking identity components", async () => {
    const source: Row[] = [["ORG", "é", 10], ["ORG", "0001", 20]];
    const actual: Row[] = [["ORG", "e\u0301", 10], ["ORG", "1", 20]];
    const report = await runArtifacts(await fixture(actual, declaration(), source));
    expect(report.reconciliations?.[0]).toMatchObject({ status: "failed", missingKeys: 2, unexpectedKeys: 2 });
  });

  it("rejects malformed dimensions before reading any artifact", async () => {
    const variants: unknown[] = [[], ["tenant_id"], ["tenant_id", "tenant_id"], ["tenant_id", ""], ["tenant_id", 1],
      ["tenant_id", "missing"], ["tenant_id", "cents"], ["a", "b", "c", "d", "e"]];
    for (const key of variants) {
      const contract = declaration(); Object.assign(contract.checks[0].source, { key });
      const options = await fixture(split, contract);
      expect((await runArtifacts({ contract: options.contract, path: join(options.root, "absent") })).exitCode).toBe(2);
    }
    const mismatched = declaration(["tenant_id", "order_id"], "order_id");
    expect((await runArtifacts(await fixture(split, mismatched))).exitCode).toBe(2);
    const nullable = declaration(); Object.assign(nullable.files[0].columns[0], { allow_empty: true });
    expect((await runArtifacts(await fixture(split, nullable))).exitCode).toBe(2);
  });
});
