import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderArtifacts, runArtifacts } from "../../src/cli/commands/artifacts.js";
import { parseArtifactReport } from "../../src/domain/artifact-report-comparison.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "declaration-checks-")); directories.push(root);
  const path = join(root, "files"); await mkdir(path);
  for (const name of ["expected.csv", "actual.csv"]) await writeFile(join(path, name), "id,cents,digest\nPRIVATE_ID,100,PRIVATE_EXPECTED_VALUE\n");
  await writeFile(join(path, "summary.json"), '{"rows":1,"cents":100}');
  const contract = { schema: "skillsync.artifacts/v1", limits: { max_files: 3, max_file_bytes: 4096, max_total_bytes: 8192 }, files: [
    ...["expected.csv", "actual.csv"].map(path => ({ path, format: "csv", max_rows: 10, unique_by: ["id"], columns: [{ name: "id", type: "string", one_of: ["PRIVATE_ID"] }, { name: "cents", type: "integer" }, { name: "digest", type: "string", equals: "PRIVATE_EXPECTED_VALUE" }] })),
    { path: "summary.json", format: "json", fields: [{ name: "rows", type: "integer" }, { name: "cents", type: "integer" }] },
  ], checks: [
    { type: "csv_summary", csv: "actual.csv", json: "summary.json", row_count_field: "rows", sums: [{ column: "cents", field: "cents" }] },
    { type: "reference_exists", source: { path: "actual.csv", field: "id" }, target: { path: "expected.csv", field: "id" }, matches: [{ source: "digest", target: "digest" }] },
    { type: "keyed_integer_sum_equals", source: { path: "expected.csv", key: "id", value: "cents" }, target: { path: "actual.csv", key: "id", value: "cents" } },
  ] };
  const file = join(root, "contract.json"); await writeFile(file, JSON.stringify(contract));
  return { path, contract: file, declaration: contract };
}

describe("declared cross-file review", () => {
  it("retains all three validated check kinds and limits without copying expected values or raw cells", async () => {
    const input = await fixture(); const report = await runArtifacts(input);
    expect(report.status).toBe("passed");
    expect(report.declarations?.checks.map(item => item.check.type)).toEqual(["csv_summary", "reference_exists", "keyed_integer_sum_equals"]);
    expect(report.declarations?.checks.map(item => item.ordinal)).toEqual([1, 2, 3]);
    expect(report.declarations?.limits.max_files).toBe(3);
    expect(parseArtifactReport(report).declarations).toEqual(report.declarations);
    for (const format of ["text", "json", "html"]) {
      const rendered = renderArtifacts(report, format);
      expect(rendered).not.toContain("PRIVATE_ID"); expect(rendered).not.toContain("PRIVATE_EXPECTED_VALUE");
      expect(rendered).toContain("csv_summary"); expect(rendered).toContain("reference_exists"); expect(rendered).toContain("keyed_integer_sum_equals");
    }
    const legacy = { ...report }; delete legacy.declarations;
    expect(parseArtifactReport(legacy).declarations).toBeUndefined();
    expect(() => parseArtifactReport({ ...report, declarations: { ...report.declarations, checks: [{ ...report.declarations!.checks[0], ordinal: 2 }] } })).toThrow();
    expect(() => parseArtifactReport({ ...report, declarations: { ...report.declarations, raw: "PRIVATE" } })).toThrow();
  });
  it("keeps declarations distinct from missing files and invalid setup", async () => {
    const input = await fixture(); await rm(join(input.path, "actual.csv"));
    const missing = await runArtifacts(input);
    expect(missing.status).toBe("failed"); expect(missing.declarations?.checks).toHaveLength(3);
    expect(renderArtifacts(missing, "html")).toContain("These are declarations, not proof of a completed check");
    await writeFile(input.contract, '{"schema":"invalid"}');
    const invalid = await runArtifacts(input);
    expect(invalid.exitCode).toBe(2); expect(invalid.declarations).toBeUndefined();
  });
});
