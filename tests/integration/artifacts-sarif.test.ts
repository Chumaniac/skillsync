import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";

async function fixture(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-sarif-"));
  try { await cp(resolve("fixtures/product/tenant-reconciliation"), root, { recursive: true }); await check(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const command = (root: string) => ["artifacts", "--contract", join(root, "contract.json"),
  "--path", join(root, "artifacts"), "--format", "sarif"];

describe("artifact SARIF CLI", () => {
  it("exports a passing inspection with no findings", async () => fixture(async root => {
    const result = await runCli(command(root));
    expect(result.exitCode).toBe(0);
    const log = JSON.parse(result.stdout);
    expect(log.version).toBe("2.1.0");
    expect(log.runs[0].tool.driver.name).toBe("skillsync-artifacts");
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].properties.execution).toBe("not-run");
    expect(result.stdout.includes(root)).toBe(false);
  }));

  it("preserves failed checks and stable locations without raw record values", async () => fixture(async root => {
    await cp(join(root, "faults/shifted-allocations.csv"), join(root, "artifacts/allocations.csv"));
    const first = await runCli(command(root));
    const second = await runCli(command(root));
    expect(first.exitCode).toBe(1);
    expect(second.stdout).toBe(first.stdout);
    const log = JSON.parse(first.stdout);
    const run = log.runs[0];
    expect(run.results.some((finding: { ruleId: string }) => finding.ruleId === "artifact.reconciliation-sum")).toBe(true);
    expect(run.results.every((finding: { level: string }) => finding.level === "error")).toBe(true);
    expect(run.results.some((finding: { locations: unknown[] }) => finding.locations.length > 0)).toBe(true);
    for (const sentinel of [root, "ORG_A", "ORG_B", "ORDER_1"]) expect(first.stdout.includes(sentinel)).toBe(false);
    expect(run.invocations[0].executionSuccessful).toBe(true);
  }));

  it("reports invalid setup as SARIF with exit 2 and no fabricated file", async () => {
    const result = await runCli(command("/private/tmp/ABSENT_ARTIFACT_SENTINEL"));
    expect(result.exitCode).toBe(2);
    const run = JSON.parse(result.stdout).runs[0];
    expect(run.invocations[0].executionSuccessful).toBe(false);
    expect(run.results[0].ruleId).toBe("artifact.contract-invalid");
    expect(run.results[0].locations).toEqual([]);
    expect(result.stdout.includes("ABSENT_ARTIFACT_SENTINEL")).toBe(false);
  });

  it("rejects comparison mode before opening caller-supplied files", async () => {
    const result = await runCli([...command("absent"), "--compare", "absent-baseline.json"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SARIF does not support --compare");
  });
});
