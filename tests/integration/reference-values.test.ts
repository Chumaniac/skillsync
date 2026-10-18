import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderArtifacts, runArtifacts } from "../../src/cli/commands/artifacts";
import { parseArtifactContract } from "../../src/domain/artifact-contract";
import { createArtifactReferenceIndex } from "../../src/domain/artifact-references";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function declaration() {
  return { schema: "skillsync.artifacts/v1", limits: { max_files: 2, max_file_bytes: 4096, max_total_bytes: 8192 },
    files: [
      { path: "citations.csv", format: "csv", columns: ["source", "digest", "version"].map(name => ({ name, type: "string" })), max_rows: 10 },
      { path: "sources.csv", format: "csv", columns: ["id", "sha256", "revision"].map(name => ({ name, type: "string" })), unique_by: ["id"], max_rows: 10 },
    ], checks: [{ type: "reference_exists", source: { path: "citations.csv", field: "source" }, target: { path: "sources.csv", field: "id" },
      matches: [{ source: "digest", target: "sha256" }, { source: "version", target: "revision" }] }] };
}
async function fixture(source = "source,digest,version\nPRIVATE_ID,known,v1\n", target = "id,sha256,revision\nPRIVATE_ID,known,v1\n", contract = declaration()) {
  const root = await mkdtemp(join(tmpdir(), "reference-values-")); dirs.push(root);
  const path = join(root, "files"); await mkdir(path);
  await writeFile(join(path, "citations.csv"), source);
  await writeFile(join(path, "sources.csv"), target);
  const file = join(root, "contract.json"); await writeFile(file, JSON.stringify(contract));
  return { root, path, contract: file };
}

describe("reference metadata binding", () => {
  it("binds different column names on repeated references without executing or fetching anything", async () => {
    const report = await runArtifacts(await fixture("source,digest,version\nPRIVATE_ID,known,v1\nPRIVATE_ID,known,v1\n"));
    expect(report.status).toBe("passed");
    expect(report.execution).toBe("not-run"); expect(report.provenance).toBe("not-authenticated");
  });
  it("rejects an existing citation ID with a changed digest or revision without disclosing values", async () => {
    for (const row of ["PRIVATE_ID,PRIVATE_DIGEST,v1", "PRIVATE_ID,known,PRIVATE_VERSION"]) {
      const report = await runArtifacts(await fixture(`source,digest,version\n${row}\n`));
      expect(report.exitCode).toBe(1);
      expect(report.findings).toEqual([{ code: "artifact.reference-value-mismatch", path: "citations.csv", field: ["digest", "version"], row: 1 }]);
      const rendered = ["json", "text", "html"].map(format => renderArtifacts(report, format)).join("");
      for (const value of ["PRIVATE_ID", "PRIVATE_DIGEST", "PRIVATE_VERSION"]) expect(rendered).not.toContain(value);
    }
  });
  it("uses unambiguous ordered tuples instead of concatenating metadata values", async () => {
    const report = await runArtifacts(await fixture("source,digest,version\nPRIVATE_ID,a|b,c\n", "id,sha256,revision\nPRIVATE_ID,a,b|c\n"));
    expect(report.findings[0].code).toBe("artifact.reference-value-mismatch");
  });
  it("keeps missing IDs separate from metadata mismatches", async () => {
    const report = await runArtifacts(await fixture("source,digest,version\nMISSING,known,v1\n"));
    expect(report.findings).toEqual([{ code: "artifact.reference-missing", path: "citations.csv", field: "source", row: 1 }]);
  });
  it("never accepts missing metadata or duplicate target identities", async () => {
    const missing = await runArtifacts(await fixture("source,digest,version\nPRIVATE_ID,,v1\n"));
    expect(missing.exitCode).toBe(1);
    expect(missing.findings.some(finding => finding.code === "artifact.reference-value-unavailable")).toBe(true);
    const duplicate = await runArtifacts(await fixture(undefined, "id,sha256,revision\nPRIVATE_ID,known,v1\nPRIVATE_ID,other,v2\n"));
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.findings.some(finding => finding.code === "artifact.csv-duplicate")).toBe(true);
  });
  it("rejects malformed bindings before inspecting the selected directory", async () => {
    for (const mutation of ["missing", "integer", "empty", "duplicate", "too-many"] as const) {
      const contract = declaration();
      if (mutation === "missing") contract.checks[0].matches[0].source = "undeclared";
      if (mutation === "integer") contract.files[0].columns[1].type = "integer";
      if (mutation === "empty") contract.checks[0].matches = [];
      if (mutation === "duplicate") contract.checks[0].matches.push(contract.checks[0].matches[0]);
      if (mutation === "too-many") contract.checks[0].matches = Array.from({ length: 9 }, () => contract.checks[0].matches[0]);
      const options = await fixture(undefined, undefined, contract);
      const report = await runArtifacts({ ...options, path: join(options.root, "absent") });
      expect(report.exitCode).toBe(2); expect(report.findings[0].code).toBe("artifact.contract-invalid");
    }
  });
  it("charges metadata indexes against the existing shared reference budget", async () => {
    const contract = declaration();
    contract.limits = { max_files: 2, max_file_bytes: 1_000_000, max_total_bytes: 2_000_000 };
    for (const file of contract.files) file.max_rows = 20_000;
    const rows = Array.from({ length: 17_000 }, (_, i) => `ID${i},known,v1\n`).join("");
    const report = await runArtifacts(await fixture("source,digest,version\n" + rows, "id,sha256,revision\n" + rows, contract));
    expect(report.findings).toEqual([{ code: "artifact.reference-capacity" }]); expect(report.exitCode).toBe(1);
  });
  it("bounds repeated metadata hashing even when the cell count stays small", () => {
    const index = createArtifactReferenceIndex(parseArtifactContract(declaration()));
    const observe = index.rowObserver("citations.csv")!;
    const values = new Map([["digest", "x".repeat(8 * 1024 * 1024)], ["version", "v1"]]);
    for (let row = 1; row <= 9; row += 1) observe(values, row);
    expect(index.findings()).toEqual([{ code: "artifact.reference-capacity" }]);
  });
});
