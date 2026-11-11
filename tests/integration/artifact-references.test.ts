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

describe("required target coverage", () => {
  it("preserves the normalized contract digest of the existing citation fixture", async () => {
    const root = join(import.meta.dirname, "../../fixtures/product/reference-integrity");
    const report = await runArtifacts({ contract: join(root, "contract.json"), path: join(root, "artifacts") });
    expect(report.exitCode).toBe(0);
    expect(report.contract_sha256).toBe("3023d7b5d113d867f7651e8743f352ef27025cfa151e9463701e0b3748677308");
  });
  it("keeps unused targets allowed by default and by an explicit false option", async () => {
    const defaults = await fixture("customer\nC1\n", "id\nC1\nC2\n");
    expect((await runArtifacts(defaults)).status).toBe("passed");
    const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: false });
    expect((await runArtifacts(await fixture("customer\nC1\n", "id\nC1\nC2\n", contract))).status).toBe("passed");
  });
  it("passes complete target coverage with repeated forward references", async () => {
    const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: true });
    const report = await runArtifacts(await fixture("customer\nC2\nC1\nC1\n", "id\nC1\nC2\n", contract));
    expect(report.status).toBe("passed"); expect(report.execution).toBe("not-run");
  });
  it("reports the uncovered target row without retaining or rendering its ID", async () => {
    const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: true });
    const report = await runArtifacts(await fixture("customer\nC1\n", "id\nC1\nDO_NOT_DISCLOSE\n", contract));
    expect(report.findings).toEqual([{ code: "artifact.reference-unused", path: "z-customers.csv", field: "id", row: 2 }]);
    expect(report.exitCode).toBe(1);
    expect(renderArtifacts(report, "json") + renderArtifacts(report)).not.toContain("DO_NOT_DISCLOSE");
  });
  it("catches an empty delivery while bounding its target findings at 256", async () => {
    const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: true });
    Object.assign(contract.files[0], { min_rows: 0 }); contract.files[1].max_rows = 300;
    const targets = "id\n" + Array.from({ length: 300 }, (_, row) => `C${row + 1}\n`).join("");
    const report = await runArtifacts(await fixture("customer\n", targets, contract));
    expect(report.exitCode).toBe(1); expect(report.findings).toHaveLength(256);
    expect(report.findings[0]).toEqual({ code: "artifact.reference-unused", path: "z-customers.csv", field: "id", row: 1 });
    expect(report.findings[255].row).toBe(256);
  });
  it("checks each declared target table independently", async () => {
    const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: true });
    contract.limits.max_files = 3;
    contract.files.push({ ...contract.files[1], path: "other-customers.csv" });
    contract.checks.push({ ...contract.checks[0], target: { path: "other-customers.csv", field: "id" } });
    const options = await fixture("customer\nC1\n", "id\nC1\nC2\n", contract);
    await writeFile(join(options.path, "other-customers.csv"), "id\nC1\n");
    const report = await runArtifacts(options);
    expect(report.findings).toEqual([{ code: "artifact.reference-unused", path: "z-customers.csv", field: "id", row: 2 }]);
  });
  it("keeps capacity failure ahead of target coverage and releases oversized indexes", async () => {
    const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: true });
    contract.limits = { max_files: 2, max_file_bytes: 1_000_000, max_total_bytes: 2_000_000 };
    for (const file of contract.files) file.max_rows = 100_000;
    const source = "customer\n" + "C1\n".repeat(50_000);
    const target = "id\n" + Array.from({ length: 50_001 }, (_, row) => `C${row + 1}\n`).join("");
    const report = await runArtifacts(await fixture(source, target, contract));
    expect(report.findings).toEqual([{ code: "artifact.reference-capacity" }]); expect(report.exitCode).toBe(1);
  });
  it("rejects non-boolean coverage options before reading artifact paths", async () => {
    for (const value of ["true", 1, null, {}]) {
      const contract = declaration(); Object.assign(contract.checks[0], { require_all_targets: value });
      const options = await fixture(undefined, undefined, contract);
      const report = await runArtifacts({ ...options, path: join(options.root, "does-not-exist") });
      expect(report.exitCode).toBe(2); expect(report.findings[0].code).toBe("artifact.contract-invalid");
    }
  });
});
