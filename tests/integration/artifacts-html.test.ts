import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

const source = resolve("fixtures/product/tenant-reconciliation");

async function fixture(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-html-"));
  try { await cp(source, root, { recursive: true }); await check(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

const command = (root: string) => ["artifacts", "--contract", join(root, "contract.json"),
  "--path", join(root, "artifacts"), "--format", "html"];

describe("human acceptance report CLI", () => {
  it("renders actual correct files without exposing their organization/order data", async () => fixture(async root => {
    const result = await runCli(command(root));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith("<!doctype html>")).toBe(true);
    expect(result.stdout.includes("Declared checks passed")).toBe(true);
    expect(result.stdout.includes("not-provided")).toBe(true);
    expect(result.stdout.includes("tenant_id + order_id")).toBe(true);
    for (const secret of [root, "ORG_A", "ORG_B", "ORDER_1"]) expect(result.stdout.includes(secret)).toBe(false);
  }));

  it("reports two actual allocation defects with file/column/action metadata", async () => fixture(async root => {
    await cp(join(root, "faults/shifted-allocations.csv"), join(root, "artifacts/allocations.csv"));
    const result = await runCli(command(root));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.includes('data-value-mismatches="2"')).toBe(true);
    expect(result.stdout.includes("Compare expected and delivered records using the declared key columns")).toBe(true);
    expect(result.stdout.includes("artifact.reconciliation-sum")).toBe(true);
    expect(result.stdout.includes("Review required")).toBe(true);
    expect(result.stdout.includes('data-source-records="1"')).toBe(true);
    expect(result.stdout.includes('data-target-records="1,3"')).toBe(true);
    expect(result.stdout.includes('data-source-records="2"')).toBe(true);
    expect(result.stdout.includes('data-target-records="2"')).toBe(true);
    expect(result.stdout.includes("exclude the header")).toBe(true);
    expect(result.stdout.includes("ORG_A")).toBe(false);
  }));

  it("keeps actual invalid sums incomplete instead of declaring zero mismatches", async () => fixture(async root => {
    const path = join(root, "artifacts/allocations.csv");
    const csv = await readFile(path, "utf8");
    await writeFile(path, csv.replace(",400", ",9007199254740991"));
    const result = await runCli(command(root));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.includes("Unknown — check incomplete")).toBe(true);
    expect(result.stdout.includes("No partial result is accepted")).toBe(true);
    expect(result.stdout.includes('data-value-mismatches="0"')).toBe(false);
  }));

  it("renders setup failure as a report without reading or revealing paths", async () => {
    const result = await runCli(["artifacts", "--contract", "/private/tmp/ABSENT_CONTRACT_SENTINEL",
      "--path", "/private/tmp/ABSENT_PAYLOAD_SENTINEL", "--format", "html"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout.includes("Check setup required")).toBe(true);
    expect(result.stdout.includes("artifact.contract-invalid")).toBe(true);
    expect(result.stdout.includes("ABSENT_CONTRACT_SENTINEL")).toBe(false);
  });

  it("advertises the offline view and rejects unsupported formats", async () => {
    const help = await runCli(["artifacts", "--help"]);
    expect(help.stdout.includes("offline html")).toBe(true);
    const invalid = await runCli(["artifacts", "--contract", "absent.json", "--path", "absent",
      "--format", "csv"]);
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stdout.includes("<!doctype html>")).toBe(false);
  });
});
