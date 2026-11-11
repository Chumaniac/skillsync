import { describe, expect, it } from "vitest";
import { renderArtifactsSarif } from "../../src/reporters/artifacts-sarif.js";
import type { ArtifactReport } from "../../src/cli/commands/artifacts.js";

const report: ArtifactReport = { schema: "skillsync.artifacts-report/v1", status: "failed", exitCode: 1,
  evidence: "physical-files", execution: "not-run", provenance: "not-authenticated", receipt_binding: "not-provided",
  files: [], findings: [] };

describe("artifact SARIF metadata boundary", () => {
  it("encodes relative paths and retains logical records without inventing CSV line numbers", () => {
    const output = renderArtifactsSarif({ ...report, findings: [{ code: "artifact.csv-type", path: "reports/审阅 #1.csv", row: 3,
      field: "PRIVATE_FIELD_SENTINEL", message: "PRIVATE_MESSAGE_SENTINEL" }] });
    const result = JSON.parse(output).runs[0].results[0];
    expect(result.locations[0].physicalLocation).toEqual({ artifactLocation: { uri: "reports/%E5%AE%A1%E9%98%85%20%231.csv" } });
    expect(result.properties.dataRecord).toBe(3);
    expect(result.partialFingerprints["skillsyncArtifacts/v1"]).toMatch(/^[a-f0-9]{64}$/);
    expect(output).not.toContain("PRIVATE_FIELD_SENTINEL");
    expect(output).not.toContain("PRIVATE_MESSAGE_SENTINEL");
  });

  it.each(["/private/ROOT_SENTINEL.csv", "C:\\private\\ROOT_SENTINEL.csv", "../ROOT_SENTINEL.csv", "https://example.com/ROOT_SENTINEL", "file:///ROOT_SENTINEL", "a/../ROOT_SENTINEL", "a//ROOT_SENTINEL", "a/\u0000ROOT_SENTINEL"])("omits unsafe location %s", path => {
    const output = renderArtifactsSarif({ ...report, findings: [{ code: "artifact.missing", path }] });
    expect(JSON.parse(output).runs[0].results[0].locations).toEqual([]);
    expect(output).not.toContain("ROOT_SENTINEL");
  });
});
