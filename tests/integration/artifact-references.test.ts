import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runArtifacts, renderArtifacts } from "../../src/cli/commands/artifacts";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

function declaration() {
  return { schema: "skillsync.artifacts/v1", limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
    files: [
      { path: "a-orders.csv", format: "csv", columns: [{ name: "customer", type: "string" }], max_rows: 10 },
      { path: "z-customers.csv", format: "csv", columns: [{ name: "id", type: "string" }], unique_by: ["id"], max_rows: 10 },
    ], checks: [{ type: "reference_exists", source: { path: "a-orders.csv", field: "customer" }, target: { path: "z-customers.csv", field: "id" } }] };
}

async function fixture(source = "customer\nC1\nC2\n", target = "id\nC2\nC1\n", contract = declaration()) {
  const root = await mkdtemp(join(tmpdir(), "artifact-references-")); dirs.push(root);
  const path = join(root, "files");
  await mkdir(path);
  await writeFile(join(path, "a-orders.csv"), source);
  await writeFile(join(path, "z-customers.csv"), target);
  const contractPath = join(root, "contract.json"); await writeFile(contractPath, JSON.stringify(contract));
  return { root, path, contract: contractPath };
}

describe("physical CSV references", () => {
  it("checks forward references after the entire physical inventory", async () => {
    const report = await runArtifacts(await fixture());
    expect(report.status).toBe("passed"); expect(report.files).toHaveLength(2);
    expect(report.execution).toBe("not-run"); expect(report.provenance).toBe("not-authenticated");
  });
  it("reports missing references with a row and no cell value", async () => {
    const report = await runArtifacts(await fixture("customer\nC1\nDO_NOT_DISCLOSE\n"));
    expect(report.findings).toEqual([{ code: "artifact.reference-missing", path: "a-orders.csv", field: "customer", row: 2 }]);
    expect(report.exitCode).toBe(1);
    expect(renderArtifacts(report, "json") + renderArtifacts(report)).not.toContain("DO_NOT_DISCLOSE");
  });
  it("preserves exact spelling rather than trimming or folding IDs", async () => {
    const report = await runArtifacts(await fixture("customer\nc1\n C1\nC1\n", "id\nC1\n"));
    expect(report.findings.map(finding => finding.row)).toEqual([1, 2]);
  });
  it("allows repeated source IDs but rejects an empty declared target table", async () => {
    expect((await runArtifacts(await fixture("customer\nC1\nC1\n", "id\nC1\n"))).exitCode).toBe(0);
    const contract = declaration(); Object.assign(contract.files[1], { min_rows: 0 });
    const report = await runArtifacts(await fixture("customer\nC1\n", "id\n", contract));
    expect(report.findings).toEqual([{ code: "artifact.reference-missing", path: "a-orders.csv", field: "customer", row: 1 }]);
  });
  it("bounds aggregate referenced cells at 100,000, including repeated IDs", async () => {
    const contract = declaration();
    contract.limits = { max_files: 2, max_file_bytes: 1_000_000, max_total_bytes: 2_000_000 };
    for (const file of contract.files) file.max_rows = 100_000;
    const source = "customer\n" + "C1\n".repeat(50_000);
    const target = "id\n" + Array.from({ length: 50_000 }, (_, index) => `C${index + 1}\n`).join("");
    const options = await fixture(source, target, contract);
    expect((await runArtifacts(options)).exitCode).toBe(0);
    await writeFile(join(options.path, "z-customers.csv"), target + "C50001\n");
    const report = await runArtifacts(options);
    expect(report.findings).toEqual([{ code: "artifact.reference-capacity" }]);
    expect(report.exitCode).toBe(1);
  });
  it("does not accept duplicate targets or invalid formula cells", async () => {
    const report = await runArtifacts(await fixture("customer\n=SECRET\n", "id\n=SECRET\n=SECRET\n"));
    expect(report.findings.some(finding => finding.code === "artifact.csv-duplicate")).toBe(true);
    expect(report.findings.some(finding => finding.code === "artifact.csv-formula")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("=SECRET");
  });
  it("rejects undeclared, non-string, empty and non-unique targets before file access", async () => {
    for (const mutation of ["undeclared", "integer", "empty", "composite"] as const) {
      const contract = declaration();
      if (mutation === "undeclared") contract.checks[0].target.path = "undeclared.csv";
      if (mutation === "integer") contract.files[1].columns[0].type = "integer";
      if (mutation === "empty") Object.assign(contract.files[1].columns[0], { allow_empty: true });
      if (mutation === "composite") {
        contract.files[1].columns.push({ name: "region", type: "string" });
        contract.files[1].unique_by = ["id", "region"];
      }
      const fixtureOptions = await fixture(undefined, undefined, contract);
      const report = await runArtifacts({ ...fixtureOptions, path: join(fixtureOptions.root, "does-not-exist") });
      expect(report.exitCode).toBe(2); expect(report.findings[0].code).toBe("artifact.contract-invalid");
    }
  });
  it("keeps physical inventory guards ahead of relational findings", async () => {
    const options = await fixture("customer\nMISSING\n");
    await symlink(join(options.path, "z-customers.csv"), join(options.path, "unexpected.csv"));
    const report = await runArtifacts(options);
    expect(report.findings[0].code).toBe("artifact.structure-or-snapshot"); expect(report.files).toEqual([]);
  });
});
