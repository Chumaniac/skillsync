import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runArtifacts, renderArtifacts } from "../../src/cli/commands/artifacts";
import { createCli } from "../../src/cli/index";

const source = resolve("fixtures/product/review-intake");
async function fixture(run: (contract: string, data: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-review-intake-"));
  try {
    await cp(join(source, "artifacts"), join(root, "artifacts"), { recursive: true });
    await cp(join(source, "contract.json"), join(root, "contract.json"));
    await run(join(root, "contract.json"), join(root, "artifacts"));
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("physical review intake labels", () => {
  it("accepts three synthetic domain records and a matching reference summary", async () => fixture(async (contract, data) => {
    const report = await runArtifacts({ contract, path: data });
    expect(report.status).toBe("passed");
    expect(report.evidence).toBe("physical-files");
    expect(report.execution).toBe("not-run");
    expect(report.provenance).toBe("not-authenticated");
    expect(report.files.find(file => file.path === "materials.csv")?.rows).toBe(3);
  }));

  it("fails unknown CSV labels through the CLI without exposing values or absolute paths", async () => fixture(async (contract, data) => {
    const path = join(data, "materials.csv"), value = "PRIVATE_SYNTHETIC_SELECTION";
    await writeFile(path, (await readFile(path, "utf8")).replace("needs-review", value));
    const report = await runArtifacts({ contract, path: data });
    expect(report.findings).toContainEqual({ code: "artifact.csv-value", path: "materials.csv", field: "decision", row: 1 });
    for (const format of ["json", "text"]) {
      const output = renderArtifacts(report, format);
      expect(output).not.toContain(value);
      expect(output).not.toContain(data);
    }
    let output = "", exitCode = 0;
    const cli = createCli({ writeOut: text => { output += text; }, writeErr: () => undefined, setExitCode: code => { exitCode = code; } });
    await cli.parseAsync(["node", "skillsync", "artifacts", "--contract", contract, "--path", data, "--format", "json"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(output).status).toBe("failed");
    expect(output).not.toContain(value);
  }));

  it("applies the same closed options to the JSON summary", async () => fixture(async (contract, data) => {
    const path = join(data, "summary.json");
    const summary = JSON.parse(await readFile(path, "utf8"));
    summary.queue = "AUTOMATIC_APPROVAL_NOT_DECLARED";
    await writeFile(path, JSON.stringify(summary));
    expect((await runArtifacts({ contract, path: data })).findings)
      .toContainEqual({ code: "artifact.json-value", path: "summary.json", field: "queue" });
  }));

  it("retains independent aggregate checks when all labels are allowed", async () => fixture(async (contract, data) => {
    const path = join(data, "summary.json");
    const summary = JSON.parse(await readFile(path, "utf8"));
    summary.total_references = 99;
    await writeFile(path, JSON.stringify(summary));
    expect((await runArtifacts({ contract, path: data })).findings)
      .toContainEqual({ code: "artifact.summary-sum", path: "summary.json", field: "total_references" });
  }));
});
