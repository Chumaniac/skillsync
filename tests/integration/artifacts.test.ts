import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runArtifacts, renderArtifacts } from "../../src/cli/commands/artifacts";
import { createCli } from "../../src/cli/index";
import { scanStagedWorkspace } from "../../src/sandbox/workspace-tree";

const source = resolve("fixtures/product/order-summary");
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function fixture(run: (root: string, contract: string, data: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-artifacts-"));
  try {
    await cp(join(source, "artifacts"), join(root, "data"), { recursive: true });
    await cp(join(source, "contract.json"), join(root, "contract.json"));
    await run(root, join(root, "contract.json"), join(root, "data"));
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function bind(bundle: string) {
  const receipt = { schema: "skilltape.dev/receipt/v1", status: "succeeded", run_id: "a".repeat(64), skill_hash: "b".repeat(64), steps: [] };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  await writeFile(join(bundle, "receipt.json"), receiptBytes);
  const files = await Promise.all(["metrics.csv", "summary.json"].map(async path => {
    const bytes = await readFile(join(bundle, "artifacts", path));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  }));
  const digest = createHash("sha256");
  for (const file of files) { const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(file.bytes));
    digest.update(file.path); digest.update(Buffer.from([0])); digest.update(size); digest.update(file.sha256); }
  await writeFile(join(bundle, "delivery.json"), JSON.stringify({ schema: "skilltape.dev/delivery/v1",
    run_id: receipt.run_id, skill_hash: receipt.skill_hash, receipt_sha256: sha(receiptBytes), artifact_set_sha256: digest.digest("hex"), files }));
}

describe("physical artifact validation", () => {
  it("rejects an ambiguous receipt and an unsorted manifest", async () => fixture(async (root, contract, data) => {
    const bundle = join(root, "bundle"); await mkdir(bundle); await cp(data, join(bundle, "artifacts"), { recursive: true }); await bind(bundle);
    const manifest = JSON.parse(await readFile(join(bundle, "delivery.json"), "utf8"));
    manifest.files.reverse(); await writeFile(join(bundle, "delivery.json"), JSON.stringify(manifest));
    expect((await runArtifacts({ contract, delivery: bundle })).status).toBe("failed");
    await bind(bundle);
    const bytes = (await readFile(join(bundle, "receipt.json"), "utf8")).replace('"status":"succeeded"', '"status":"failed","status":"succeeded"');
    await writeFile(join(bundle, "receipt.json"), bytes);
    const changed = JSON.parse(await readFile(join(bundle, "delivery.json"), "utf8")); changed.receipt_sha256 = sha(bytes);
    await writeFile(join(bundle, "delivery.json"), JSON.stringify(changed));
    expect((await runArtifacts({ contract, delivery: bundle })).receipt_binding).toBe("failed");
  }));
  it("checks actual files and independently compares CSV and JSON totals", async () => fixture(async (_root, contract, data) => {
    const report = await runArtifacts({ contract, path: data });
    expect(report.status).toBe("passed"); expect(report.evidence).toBe("physical-files");
    expect(report.execution).toBe("not-run"); expect(report.receipt_binding).toBe("not-provided");
    expect(report.files.find(file => file.path === "metrics.csv")?.rows).toBe(2);
    expect(report.files).toHaveLength(2);
  }));
  it("rejects an internally inconsistent summary even with updated bundle hashes", async () => fixture(async (root, contract, data) => {
    const bundle = join(root, "bundle"); await mkdir(bundle); await cp(data, join(bundle, "artifacts"), { recursive: true });
    await writeFile(join(bundle, "artifacts", "summary.json"), JSON.stringify({ schema_version: 1, row_count: 2, total_orders: 3, total_cents: 9999 }));
    await bind(bundle);
    const report = await runArtifacts({ contract, delivery: bundle });
    expect(report.receipt_binding).toBe("verified"); expect(report.status).toBe("failed");
    expect(report.findings).toContainEqual({ code: "artifact.summary-sum", path: "summary.json", field: "total_cents" });
  }));
  it("rejects actual corruption against the retained manifest", async () => fixture(async (root, contract, data) => {
    const bundle = join(root, "bundle"); await mkdir(bundle); await cp(data, join(bundle, "artifacts"), { recursive: true }); await bind(bundle);
    expect((await runArtifacts({ contract, delivery: bundle })).status).toBe("passed");
    await writeFile(join(bundle, "artifacts", "metrics.csv"), "day,orders,total_cents\n2026-01-01,1,1\n");
    const report = await runArtifacts({ contract, delivery: bundle });
    expect(report.status).toBe("failed"); expect(report.findings.some(finding => finding.code === "delivery.artifact-digest")).toBe(true);
  }));
  it("rejects undeclared private files before any payload callback", async () => fixture(async (_root, _contract, data) => {
    await writeFile(join(data, "private.txt"), "NEVER_READ_PRIVATE_FILE");
    let reads = 0;
    await expect(scanStagedWorkspace(data, { allowedFiles: new Set(["metrics.csv", "summary.json"]), inspectFile: () => { reads += 1; } })).rejects.toThrow("not declared");
    expect(reads).toBe(0);
  }));
  it("rejects symlinks, missing files and capacity overruns", async () => fixture(async (root, contract, data) => {
    await rm(join(data, "metrics.csv"));
    expect((await runArtifacts({ contract, path: data })).findings).toContainEqual({ code: "artifact.missing", path: "metrics.csv" });
    await symlink(join(source, "artifacts", "metrics.csv"), join(data, "metrics.csv"));
    expect((await runArtifacts({ contract, path: data })).status).toBe("failed");
    await rm(join(data, "metrics.csv")); await cp(join(source, "artifacts", "metrics.csv"), join(data, "metrics.csv"));
    const value = JSON.parse(await readFile(contract, "utf8")); value.limits.max_file_bytes = 1;
    await writeFile(contract, JSON.stringify(value));
    expect((await runArtifacts({ contract, path: data })).findings[0].code).toBe("artifact.capacity");
    const alias = join(root, "alias"); await symlink(data, alias);
    expect((await runArtifacts({ contract, path: alias })).status).toBe("failed");
  }));
  it("rejects a file modified during inspection", async () => fixture(async (_root, _contract, data) => {
    await expect(scanStagedWorkspace(data, { inspectFile: async path => {
      if (path === "metrics.csv") await writeFile(join(data, path), "changed during inspection");
    } })).rejects.toThrow("changed during inspection");
  }));
  it("keeps local paths and private values out of CLI reports", async () => fixture(async (_root, contract, data) => {
    await writeFile(join(data, "summary.json"), '{"schema_version":1,"row_count":2,"total_orders":3,"total_cents":"NEVER_EXPOSE_PRIVATE_VALUE"}');
    const report = await runArtifacts({ contract, path: data });
    expect(report.status).toBe("failed");
    for (const format of ["json", "text"]) { const output = renderArtifacts(report, format);
      expect(output).not.toContain(data); expect(output).not.toContain("NEVER_EXPOSE_PRIVATE_VALUE"); }
    let output = "", exitCode = 0;
    const program = createCli({ writeOut: text => { output += text; }, writeErr: () => undefined, setExitCode: code => { exitCode = code; } });
    await program.parseAsync(["node", "skillsync", "artifacts", "--contract", contract, "--path", data, "--format", "json"]);
    expect(exitCode).toBe(1); expect(JSON.parse(output).status).toBe("failed");
  }));
});
