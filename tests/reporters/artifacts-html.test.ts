import { describe, expect, it } from "vitest";
import { renderArtifacts, type ArtifactReport } from "../../src/cli/commands/artifacts.js";
import { renderArtifactsFragment } from "../../src/reporters/artifacts-html.js";
import { VERSION } from "../../src/version.js";

function report(): ArtifactReport {
  return { schema: "skillsync.artifacts-report/v1", status: "passed", exitCode: 0,
    evidence: "physical-files", execution: "not-run", provenance: "not-authenticated",
    receipt_binding: "verified", files: [{ path: "expected.csv", bytes: 70, rows: 2, sha256: "a".repeat(64) }],
    findings: [], reconciliations: [{ type: "keyed_integer_sum_equals", status: "passed",
      source: { path: "expected.csv", key: ["tenant_id", "order_id"], value: "cents" },
      target: { path: "allocations.csv", key: ["tenant_id", "order_id"], value: "cents" },
      sourceKeys: 2, targetKeys: 2, missingKeys: 0, unexpectedKeys: 0, valueMismatches: 0 }] };
}

describe("offline artifact acceptance HTML", () => {
  it("isolates batch anchor namespaces and rejects attribute injection in a prefix", () => {
    const html=renderArtifactsFragment(report(),"batch-north-");
    expect(html).toContain('id="batch-north-issue-title"');
    expect(html).toContain('href="#batch-north-file-title"');
    expect(html).not.toMatch(/<!doctype|<style|<iframe|<script/i);
    expect(()=>renderArtifactsFragment(report(),'bad" onclick="x')).toThrow("报告分区前缀无效");
  });
  it("escapes and bounds declaration metadata with no scripts or external destinations", () => {
    const value = report();
    value.declarations = { limits: { max_files: 3, max_file_bytes: 4096, max_total_bytes: 8192 }, checks: Array.from({ length: 128 }, (_, index) => ({ ordinal: index + 1, check: { type: "csv_summary" as const, csv: "<script>SOURCE</script>", json: "/private/tmp/PRIVATE_DECLARATION", row_count_field: "rows", sums: Array.from({ length: 128 }, () => ({ column: "&".repeat(128), field: "&".repeat(128) })) } })) };
    const html = renderArtifacts(value, "html");
    expect(html).not.toMatch(/<script\b|<img\b|https?:\/\//iu);
    expect(html).not.toContain("PRIVATE_DECLARATION");
    expect(html).toContain('href="#declarations"');
    expect(html.match(/id="declared-check-/gu)).toHaveLength(128);
    expect(html).toContain("展示 8 / 128 个求和映射");
    expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024);
  });
  it("turns physical evidence into a human decision surface without stronger claims", () => {
    const html = renderArtifacts(report(), "html");
    expect(html).toMatch(/^<!doctype html>/iu);
    expect(html.includes("声明的检查已通过")).toBe(true);
    expect(html.includes("tenant_id + order_id")).toBe(true);
    expect(html.includes("expected.csv")).toBe(true);
    expect(html.includes("execution: not-run")).toBe(true);
    expect(html.includes("provenance: not-authenticated")).toBe(true);
    expect(html.includes("回执与文件绑定")).toBe(true);
    expect(html.includes(VERSION)).toBe(true);
    expect(html.includes("default-src &#39;none&#39;")).toBe(true);
    expect(html).not.toMatch(/<script\b|<iframe\b|<img\b|https?:\/\//iu);
  });

  it("shows mismatches and a concrete review action even when totals could balance", () => {
    const value = report(); value.status = "failed"; value.exitCode = 1;
    value.reconciliations![0].status = "failed"; value.reconciliations![0].valueMismatches = 2;
    value.findings = [{ code: "artifact.reconciliation-sum", path: "allocations.csv", field: "cents" }];
    const html = renderArtifacts(value, "html");
    expect(html.includes("需要复核")).toBe(true);
    expect(html.includes("数值不一致")).toBe(true);
    expect(html.includes('data-value-mismatches="2"')).toBe(true);
    expect(html.includes("按声明的键列比较预期与交付记录")).toBe(true);
    expect(html.includes("声明的检查已通过")).toBe(false);
  });

  it("keeps incomplete reconciliation distinct from a zero mismatch result", () => {
    const value = report(); value.status = "failed"; value.exitCode = 1;
    const { type, source, target } = value.reconciliations![0];
    value.reconciliations = [{ type, source, target, status: "unknown" }];
    value.findings = [{ code: "artifact.reconciliation-capacity" }];
    const html = renderArtifacts(value, "html");
    expect(html.includes("未知，检查未完成")).toBe(true);
    expect(html.includes("不接受部分检查结果")).toBe(true);
    expect(html.includes('data-value-mismatches="0"')).toBe(false);
  });

  it("redacts local paths first and escapes every caller-controlled metadata surface", () => {
    const value = report();
    value.files[0].path = '/private/tmp/LOCAL_PATH_SENTINEL';
    value.findings = [{ code: '<b data-probe="code">CODE_SENTINEL</b>',
      path: "relative/<script>PATH_SENTINEL</script>", field: ['KEY<&"', 'NEXT<em>FIELD_SENTINEL</em>'],
      message: 'MESSAGE_SENTINEL <img src="x"> at /private/tmp/LOCAL_MESSAGE_SENTINEL', row: 7 }];
    value.reconciliations![0].target.path = "nested/<i>DESTINATION_SENTINEL</i>.csv";
    value.reconciliations![0].source.key = ['<strong>KEY_SENTINEL</strong>', 'a&b'];
    const html = renderArtifacts(value, "html");
    expect(html).not.toMatch(/<script\b|<img\b|<b data-probe|<strong>KEY_SENTINEL/iu);
    expect(html.includes("LOCAL_PATH_SENTINEL")).toBe(false);
    expect(html.includes("LOCAL_MESSAGE_SENTINEL")).toBe(false);
    expect(html.includes("&lt;local-path&gt;")).toBe(true);
    expect(html.includes("&lt;script&gt;PATH_SENTINEL&lt;/script&gt;")).toBe(true);
    expect(html.includes("KEY&lt;&amp;&quot;")).toBe(true);
    expect(html.includes("&lt;i&gt;DESTINATION_SENTINEL&lt;/i&gt;")).toBe(true);
  });

  it("bounds human details while retaining truthful full-scope counts", () => {
    const value = report();
    value.files = Array.from({ length: 1000 }, (_, i) => ({ path: `file-${i}.csv`, bytes: 1, sha256: "a".repeat(64) }));
    value.reconciliations = Array.from({ length: 128 }, () => ({ ...report().reconciliations![0] }));
    value.findings = Array.from({ length: 256 }, () => ({ code: "artifact.json-value", message: "x".repeat(10_000) }));
    const html = renderArtifacts(value, "html");
    expect(html.includes("展示 100 / 1000 个文件")).toBe(true);
    expect(html.includes("展示 64 / 128 项对账检查")).toBe(true);
    expect(html.includes("超过160字符的元数据会缩短展示")).toBe(true);
    expect(html.includes("file-100.csv")).toBe(false);
    expect(html.includes("x".repeat(161))).toBe(false);
    expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024);
  });
  it("escapes and bounds reference locations and column mappings", () => {
    const value = report(); value.status = "failed"; value.exitCode = 1;
    value.findings = [{ code: "artifact.reference-value-mismatch", path: "citations.csv", row: 1,
      reference: { path: "/private/tmp/PRIVATE_REFERENCE_PATH", field: "<script>key</script>", row: 2,
        matches: Array.from({ length: 20 }, () => ({ source: '<img src="x">', target: '<svg onload="x">' })) } }];
    const html = renderArtifacts(value, "html");
    expect(html).not.toContain("PRIVATE_REFERENCE_PATH");
    expect(html).not.toMatch(/<script\b|<img\b|<svg\b/iu);
    expect(html).toContain("&lt;local-path&gt;");
    expect(html).toContain("&lt;script&gt;key&lt;/script&gt;");
    expect(html.match(/data-source-column=/gu)).toHaveLength(8);
  });
  it("limits expanded reference context while retaining every reported finding", () => {
    const value = report(); value.status = "failed"; value.exitCode = 1;
    value.findings = Array.from({ length: 256 }, () => ({ code: "artifact.reference-value-mismatch", path: "citations.csv", row: 1,
      reference: { path: "sources.csv", field: "id", row: 2,
        matches: Array.from({ length: 8 }, () => ({ source: "&".repeat(128), target: "&".repeat(128) })) } }));
    const html = renderArtifacts(value, "html");
    expect(html).toContain("展示 256 项问题中的前 32 项");
    expect(html.match(/data-reference-path=/gu)).toHaveLength(32);
    expect(html.match(/artifact[.]reference-value-mismatch/gu)).toHaveLength(256);
    expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024);
  });
});
