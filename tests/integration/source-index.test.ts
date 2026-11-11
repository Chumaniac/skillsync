import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runArtifacts, renderArtifacts } from "../../src/cli/commands/artifacts";
import { createCli } from "../../src/cli/index";

const source = resolve("fixtures/product/source-index");
async function fixture(run: (contract: string, data: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-source-index-"));
  try {
    await cp(join(source, "artifacts"), join(root, "artifacts"), { recursive: true });
    await cp(join(source, "contract.json"), join(root, "contract.json"));
    await run(join(root, "contract.json"), join(root, "artifacts"));
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("physical knowledge source inventory", () => {
  it("accepts two declared sources with a matching summary without executing a provider", async () => fixture(async (contract, data) => {
    const report = await runArtifacts({ contract, path: data });
    expect(report.status).toBe("passed");
    expect(report.evidence).toBe("physical-files");
    expect(report.execution).toBe("not-run");
    expect(report.provenance).toBe("not-authenticated");
    expect(report.files.find(file => file.path === "sources.csv")?.rows).toBe(2);
    expect(report.files).toHaveLength(2);
  }));

  it("rejects a lookalike host through the CLI without exposing URL or local paths", async () => fixture(async (contract, data) => {
    const file = join(data, "sources.csv");
    const value = "https://docs.example.test.attacker.test/PRIVATE_SYNTHETIC_TITLE";
    await writeFile(file, (await readFile(file, "utf8")).replace("https://docs.example.test/reference-one", value));
    const report = await runArtifacts({ contract, path: data });
    expect(report.findings).toContainEqual({ code: "artifact.csv-value", path: "sources.csv", field: "source_url", row: 1 });
    for (const format of ["json", "text"]) {
      const output = renderArtifacts(report, format);
      expect(output).not.toContain(value);
      expect(output).not.toContain("PRIVATE_SYNTHETIC_TITLE");
      expect(output).not.toContain(data);
    }
    let output = "", exitCode = 0;
    const program = createCli({ writeOut: text => { output += text; }, writeErr: () => undefined, setExitCode: code => { exitCode = code; } });
    await program.parseAsync(["node", "skillsync", "artifacts", "--contract", contract, "--path", data, "--format", "json"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(output).status).toBe("failed");
    expect(output).not.toContain(value);
  }));

  it("independently rejects invented reference totals", async () => fixture(async (contract, data) => {
    await writeFile(join(data, "summary.json"), JSON.stringify({ schema_version: 1, row_count: 2, total_references: 99 }));
    const report = await runArtifacts({ contract, path: data });
    expect(report.status).toBe("failed");
    expect(report.findings).toContainEqual({ code: "artifact.summary-sum", path: "summary.json", field: "total_references" });
  }));

  it("retains duplicate-document and capacity checks", async () => fixture(async (contract, data) => {
    const file = join(data, "sources.csv");
    await writeFile(file, (await readFile(file, "utf8")).replace("SYN-NOTE-002", "SYN-NOTE-001"));
    expect((await runArtifacts({ contract, path: data })).findings.some(finding => finding.code === "artifact.csv-duplicate")).toBe(true);
    const declaration = JSON.parse(await readFile(contract, "utf8"));
    declaration.limits.max_file_bytes = 1;
    await writeFile(contract, JSON.stringify(declaration));
    expect((await runArtifacts({ contract, path: data })).findings[0].code).toBe("artifact.capacity");
  }));
});
