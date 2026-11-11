import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import { renderArtifacts, runArtifacts, type ArtifactReport } from "../../src/cli/commands/artifacts.js";
import { compareArtifactReports, parseArtifactReport } from "../../src/domain/artifact-report-comparison.js";

async function fixture(check: (root: string, options: { path: string; contract: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skillsync-comparison-"));
  try {
    await cp(resolve("fixtures/product/tenant-reconciliation"), root, { recursive: true });
    await check(root, { path: join(root, "artifacts"), contract: join(root, "contract.json") });
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function save(root: string, value: ArtifactReport) {
  const path = join(root, "previous.json");
  await writeFile(path, renderArtifacts(value, "json"));
  return path;
}

describe("artifact correction review", () => {
  it.each([
    ["passed", "verified", true], ["passed", "not-provided", true], ["passed", "failed", false],
    ["failed", "verified", true], ["failed", "not-provided", true], ["failed", "failed", true],
  ] as const)("validates report %s with receipt %s consistently", async (status, binding, valid) => fixture(async (_root, options) => {
    const report = await runArtifacts(options);
    report.status = status; report.exitCode = status === "passed" ? 0 : 1; report.receipt_binding = binding;
    if (valid) expect(parseArtifactReport(report)).toEqual(report);
    else expect(() => parseArtifactReport(report)).toThrow();
  }));

  it("compares actual corrected files, preserves originals and omits private record values", async () => fixture(async (root, options) => {
    const correct = await readFile(join(options.path, "allocations.csv"));
    await cp(join(root, "faults/shifted-allocations.csv"), join(options.path, "allocations.csv"));
    const before = await runArtifacts(options);
    expect(before.exitCode).toBe(1);
    before.findings[0].message = "PRIVATE_HISTORY_MESSAGE";
    const baseline = await save(root, before), preserved = await readFile(baseline);
    await writeFile(join(options.path, "allocations.csv"), correct);
    const result = await runCli(["artifacts", "--contract", options.contract, "--path", options.path,
      "--compare", baseline, "--format", "html"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("相较基准复核的变化");
    expect(result.stdout).toContain("1 改善");
    expect(result.stdout).toContain("已解决");
    expect(result.stdout).not.toMatch(/PRIVATE_HISTORY_MESSAGE|ORG_A|ORG_B|ORDER_1|<script\b|<iframe\b/);
    expect(result.stdout).not.toContain(root);
    expect(await readFile(baseline)).toEqual(preserved);
    const after = await runArtifacts({ ...options, compare: baseline });
    expect(after.comparison).toMatchObject({ status: "compared", baseline_status: "failed", current_status: "passed",
      findings: { added: 0, ongoing: 0, resolved: 1 }, checks: [{ before: "failed", after: "passed", change: "improved" }] });
    expect(parseArtifactReport(JSON.parse(renderArtifacts(after, "json")))).toEqual(after);
  }));

  it("detects regressions in a new delivery without altering ordinary checks", async () => fixture(async (root, options) => {
    const baseline = await save(root, await runArtifacts(options));
    await cp(join(root, "faults/shifted-allocations.csv"), join(options.path, "allocations.csv"));
    const after = await runArtifacts({ ...options, compare: baseline });
    expect(after.exitCode).toBe(1);
    expect(after.comparison?.checks?.[0].change).toBe("regressed");
    expect(after.comparison?.findings).toEqual({ added: 1, ongoing: 0, resolved: 0 });
    const ordinary = await runArtifacts(options);
    expect(ordinary.comparison).toBeUndefined();
    expect(renderArtifacts(ordinary, "html")).not.toContain("相较基准复核的变化");
  }));

  it("fails comparison on changed expectations while retaining the current inspection result", async () => fixture(async (root, options) => {
    const before = await runArtifacts(options);
    before.contract_sha256 = "b".repeat(64);
    const after = await runArtifacts({ ...options, compare: await save(root, before) });
    expect(after.exitCode).toBe(2);
    expect(after.status).toBe("failed");
    expect(after.comparison).toMatchObject({ status: "unavailable", reason: "contract-changed", current_status: "passed" });
    expect(after.comparison?.findings).toBeUndefined();
    expect(renderArtifacts(after, "html")).not.toContain("Declared checks passed");
  }));

  it("never resolves partial, saturated or mismatched-declaration evidence", async () => fixture(async (_root, options) => {
    const report = await runArtifacts(options);
    const unknown = structuredClone(report); unknown.status = "failed"; unknown.exitCode = 1;
    unknown.reconciliations = [{ ...report.reconciliations![0], status: "unknown", sourceKeys: undefined,
      targetKeys: undefined, missingKeys: undefined, unexpectedKeys: undefined, valueMismatches: undefined }];
    for (const prior of [unknown, { ...report, receipt_binding: "failed" as const },
      { ...report, status: "failed" as const, exitCode: 1, findings: Array.from({ length: 256 }, () => ({ code: "artifact.missing" })) }]) {
      const value = compareArtifactReports(prior, report, "a".repeat(64));
      expect(value).toMatchObject({ status: "unavailable", reason: "incomplete-evidence" });
      expect(value.findings).toBeUndefined();
    }
    const altered = structuredClone(report); altered.reconciliations![0].target.key = "another-column";
    expect(compareArtifactReports(altered, report, "a".repeat(64)).reason).toBe("check-declarations-changed");
  }));

  it("strictly validates historical reports before the current directory is inspected", async () => fixture(async (root, options) => {
    const good = await runArtifacts(options);
    const duplicate = { ...good, files: [...good.files, good.files[0]] };
    for (const invalid of [{ ...good, schema: "other" }, { ...good, rawRecords: ["PRIVATE_VALUE"] }, duplicate,
      { ...good, receipt_binding: "failed" },
      { ...good, artifact_set_sha256: "a".repeat(64) }, { ...good, files: [{ ...good.files[0], path: "../escape" }] },
      { ...good, reconciliations: [{ ...good.reconciliations![0], valueMismatches: -1 }] },
      { ...good, findings: Array.from({ length: 257 }, () => ({ code: "artifact.missing" })) }]) {
      const baseline = join(root, "invalid.json"); await writeFile(baseline, JSON.stringify(invalid));
      const result = await runArtifacts({ ...options, path: join(root, "ABSENT_PRIVATE_PATH"), compare: baseline });
      expect(result.exitCode).toBe(2);
      expect(result.findings).toEqual([{ code: "artifact.baseline-invalid" }]);
      expect(renderArtifacts(result, "json")).not.toContain("PRIVATE_");
    }
  }));

  it("bounds bytes, refuses symlinks and rejects duplicate JSON members without leaking setup data", async () => fixture(async (root, options) => {
    const oversized = join(root, "large.json"); await writeFile(oversized, " ".repeat(1024 * 1024 + 1));
    const original = await save(root, await runArtifacts(options));
    const link = join(root, "linked.json"); await symlink(original, link);
    const duplicate = join(root, "duplicate.json"); await writeFile(duplicate, '{"schema":"a","schema":"b"}');
    for (const compare of [oversized, link, duplicate, join(root, "MISSING_PRIVATE_PATH")]) {
      const result = await runArtifacts({ ...options, compare });
      expect(result.findings).toEqual([{ code: "artifact.baseline-invalid" }]);
      expect(renderArtifacts(result, "html")).not.toContain(root);
    }
  }));

  it("bounds HTML transitions while keeping truthful full-scope counts", async () => fixture(async (_root, options) => {
    const before = await runArtifacts(options), after = structuredClone(before);
    before.reconciliations = Array.from({ length: 128 }, () => before.reconciliations![0]);
    after.reconciliations = Array.from({ length: 128 }, () => after.reconciliations![0]);
    after.comparison = compareArtifactReports(before, after, "c".repeat(64));
    const html = renderArtifacts(after, "html");
    expect(html).toContain("按声明顺序展示 64 / 128 项检查变化");
    expect(html).toContain("128 未变化");
    expect(html).not.toContain('<td>65</td>');
    expect(Buffer.byteLength(html)).toBeLessThan(1024 * 1024);
  }));
});
