import { describe, expect, it } from "vitest";
import { renderArtifacts, type ArtifactReport } from "../../src/cli/commands/artifacts.js";
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
  it("turns physical evidence into a human decision surface without stronger claims", () => {
    const html = renderArtifacts(report(), "html");
    expect(html).toMatch(/^<!doctype html>/iu);
    expect(html.includes("Declared checks passed")).toBe(true);
    expect(html.includes("tenant_id + order_id")).toBe(true);
    expect(html.includes("expected.csv")).toBe(true);
    expect(html.includes("execution: not-run")).toBe(true);
    expect(html.includes("provenance: not-authenticated")).toBe(true);
    expect(html.includes("Receipt / file binding")).toBe(true);
    expect(html.includes(VERSION)).toBe(true);
    expect(html.includes("default-src &#39;none&#39;")).toBe(true);
    expect(html).not.toMatch(/<script\b|<iframe\b|<img\b|https?:\/\//iu);
  });

  it("shows mismatches and a concrete review action even when totals could balance", () => {
    const value = report(); value.status = "failed"; value.exitCode = 1;
    value.reconciliations![0].status = "failed"; value.reconciliations![0].valueMismatches = 2;
    value.findings = [{ code: "artifact.reconciliation-sum", path: "allocations.csv", field: "cents" }];
    const html = renderArtifacts(value, "html");
    expect(html.includes("Review required")).toBe(true);
    expect(html.includes("Mismatched values")).toBe(true);
    expect(html.includes('data-value-mismatches="2"')).toBe(true);
    expect(html.includes("Compare expected and delivered records using the declared key columns")).toBe(true);
    expect(html.includes("Declared checks passed")).toBe(false);
  });

  it("keeps incomplete reconciliation distinct from a zero mismatch result", () => {
    const value = report(); value.status = "failed"; value.exitCode = 1;
    const { type, source, target } = value.reconciliations![0];
    value.reconciliations = [{ type, source, target, status: "unknown" }];
    value.findings = [{ code: "artifact.reconciliation-capacity" }];
    const html = renderArtifacts(value, "html");
    expect(html.includes("Unknown — check incomplete")).toBe(true);
    expect(html.includes("No partial result is accepted")).toBe(true);
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
    expect(html.includes("Showing 100 of 1000 files")).toBe(true);
    expect(html.includes("Showing 64 of 128 reconciliation checks")).toBe(true);
    expect(html.includes("Metadata values longer than 160 characters are shortened")).toBe(true);
    expect(html.includes("file-100.csv")).toBe(false);
    expect(html.includes("x".repeat(161))).toBe(false);
    expect(Buffer.byteLength(html)).toBeLessThan(2 * 1024 * 1024);
  });
});
