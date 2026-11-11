import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runArtifacts, renderArtifacts } from "../../src/cli/commands/artifacts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

function declaration() {
  const columns = [{ name: "id", type: "string" }, { name: "cents", type: "integer" }];
  return { schema: "skillsync.artifacts/v1", limits: { max_files: 3, max_file_bytes: 1_000_000, max_total_bytes: 3_000_000 },
    files: [
      { path: "expected.csv", format: "csv", columns, unique_by: ["id"], max_rows: 100_000 },
      { path: "actual.csv", format: "csv", columns, max_rows: 100_000 },
      { path: "summary.json", format: "json", fields: ["expected_rows", "actual_rows", "total_cents"].map(name => ({ name, type: "integer" })) },
    ], checks: [
      { type: "csv_summary", csv: "expected.csv", json: "summary.json", row_count_field: "expected_rows", sums: [{ column: "cents", field: "total_cents" }] },
      { type: "csv_summary", csv: "actual.csv", json: "summary.json", row_count_field: "actual_rows", sums: [{ column: "cents", field: "total_cents" }] },
      { type: "reference_exists", source: { path: "actual.csv", field: "id" }, target: { path: "expected.csv", field: "id" }, require_all_targets: true },
      { type: "keyed_integer_sum_equals", source: { path: "expected.csv", key: "id", value: "cents" }, target: { path: "actual.csv", key: "id", value: "cents" } },
    ] };
}

async function fixture(expected = "id,cents\nPRIVATE_A,10\nPRIVATE_B,20\n", actual = "id,cents\nPRIVATE_A,4\nPRIVATE_B,20\nPRIVATE_A,6\n", contract = declaration()) {
  const root = await mkdtemp(join(tmpdir(), "artifact-reconciliation-")); dirs.push(root);
  const path = join(root, "data"); await mkdir(path);
  await writeFile(join(path, "expected.csv"), expected); await writeFile(join(path, "actual.csv"), actual);
  const rows = (text: string) => text.trimEnd().split("\n").slice(1);
  const total = rows(expected).reduce((sum, row) => sum + Number(row.split(",")[1]), 0);
  await writeFile(join(path, "summary.json"), JSON.stringify({ expected_rows: rows(expected).length, actual_rows: rows(actual).length, total_cents: total }));
  const contractPath = join(root, "contract.json"); await writeFile(contractPath, JSON.stringify(contract));
  return { root, path, contract: contractPath };
}

describe("per-key integer delivery reconciliation", () => {
  it("accepts split deliveries without requiring duplicate keys to be unique", async () => {
    const report = await runArtifacts(await fixture());
    expect(report.exitCode).toBe(0);
    expect(report).toMatchObject({ execution: "not-run", provenance: "not-authenticated", reconciliations: [
      { status: "passed", sourceKeys: 2, targetKeys: 2, missingKeys: 0, unexpectedKeys: 0, valueMismatches: 0 },
    ] });
  });

  it("finds wrong allocation that passes physical hashes, coverage and grand totals", async () => {
    const shifted = "id,cents\nPRIVATE_A,11\nPRIVATE_B,19\n";
    const legacy = declaration(); legacy.checks.pop();
    expect((await runArtifacts(await fixture(undefined, shifted, legacy))).exitCode).toBe(0);
    const report = await runArtifacts(await fixture(undefined, shifted));
    expect(report.exitCode).toBe(1);
    expect(report.findings).toContainEqual({ code: "artifact.reconciliation-sum", path: "actual.csv", field: "cents" });
    expect(report).toMatchObject({ reconciliations: [{ status: "failed", missingKeys: 0, unexpectedKeys: 0, valueMismatches: 2 }] });
    for (const format of ["json", "text"]) {
      const output = renderArtifacts(report, format);
      expect(output).not.toContain("PRIVATE_A"); expect(output).not.toContain("PRIVATE_B"); expect(output).not.toContain(shifted);
    }
  });

  it("compares exact key spelling and identifies missing and extra keys", async () => {
    const report = await runArtifacts(await fixture(undefined, "id,cents\n PRIVATE_A,10\nPRIVATE_B,20\n"));
    expect(report.findings).toContainEqual({ code: "artifact.reconciliation-keys", path: "actual.csv", field: "id" });
    expect(report).toMatchObject({ reconciliations: [{ status: "failed", missingKeys: 1, unexpectedKeys: 1 }] });
  });

  it("rejects a per-key overflow even when the global total remains a safe zero", async () => {
    const max = Number.MAX_SAFE_INTEGER;
    const expected = `id,cents\nA,${max}\nB,${-max}\n`;
    const actual = `id,cents\nA,${max}\nB,${-max}\nA,1\nB,-1\n`;
    const report = await runArtifacts(await fixture(expected, actual));
    expect(report.exitCode).toBe(1);
    expect(report.findings.some(finding => finding.code === "artifact.reconciliation-unsafe-sum")).toBe(true);
    expect(report).toMatchObject({ reconciliations: [{ status: "unknown" }] });
  });

  it("fails closed at the aggregate 100,000 selected-cell ceiling and releases partial conclusions", async () => {
    const contract = declaration(); contract.files[0].unique_by = [];
    contract.checks.splice(2, 1);
    const csv = "id,cents\n" + "A,1\n".repeat(25_000);
    expect((await runArtifacts(await fixture(csv, csv, contract))).exitCode).toBe(0);
    const report = await runArtifacts(await fixture(csv, csv + "A,1\n", contract));
    expect(report.findings.some(finding => finding.code === "artifact.reconciliation-capacity")).toBe(true);
    expect(report).toMatchObject({ reconciliations: [{ status: "unknown" }] });
  });

  it("rejects invalid declarations before reading delivery files", async () => {
    for (const mutation of ["undeclared", "numeric-key", "non-integer", "empty-key", "same-file", "same-file-different-value"] as const) {
      const contract = declaration();
      if (mutation === "undeclared") Object.assign(contract.checks.at(-1)!.target!, { path: "undeclared.csv" });
      if (mutation === "numeric-key") contract.files[0].columns![0].type = "integer";
      if (mutation === "non-integer") contract.files[0].columns![1].type = "number";
      if (mutation === "empty-key") Object.assign(contract.files[0].columns![0], { allow_empty: true });
      if (mutation.startsWith("same-file")) Object.assign(contract.checks.at(-1)!.target!, { path: "expected.csv" });
      if (mutation === "same-file-different-value") {
        contract.files[0].columns!.push({ name: "actual_cents", type: "integer" });
        Object.assign(contract.checks.at(-1)!.target!, { value: "actual_cents" });
      }
      const options = await fixture(undefined, undefined, contract);
      const report = await runArtifacts({ contract: options.contract, path: join(options.root, "does-not-exist") });
      expect(report.exitCode).toBe(2); expect(report.findings).toEqual([{ code: "artifact.contract-invalid" }]);
    }
  });
});
