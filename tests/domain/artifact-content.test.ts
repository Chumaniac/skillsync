import { describe, expect, it } from "vitest";
import { parseArtifactContract } from "../../src/domain/artifact-contract";
import { inspectArtifactContent } from "../../src/domain/artifact-content";

function rule(options: Record<string, unknown> = {}) {
  return parseArtifactContract({ schema: "skillsync.artifacts/v1",
    limits: { max_files: 8, max_file_bytes: 10000, max_total_bytes: 20000 },
    files: [{ path: "data.csv", format: "csv", columns: [{ name: "label", type: "string" }, { name: "count", type: "integer" }],
      unique_by: ["label"], max_rows: 10, ...options }] }).files[0];
}

describe("actual artifact formats", () => {
  it("rejects duplicate JSON keys rather than choosing a conflicting last value", () => {
    const json = parseArtifactContract({ schema: "skillsync.artifacts/v1",
      limits: { max_files: 8, max_file_bytes: 10000, max_total_bytes: 20000 },
      files: [{ path: "data.json", format: "json", fields: [{ name: "version", type: "integer", equals: 1 }] }] }).files[0];
    expect(inspectArtifactContent(json, Buffer.from('{"version":2,"version":1}')).findings[0]?.code).toBe("artifact.json-invalid");
    expect(inspectArtifactContent(json, Buffer.from('{"version":2,"\\u0076ersion":1}')).findings[0]?.code).toBe("artifact.json-invalid");
  });
  it("treats an explicitly allowed empty CSV as zero integer totals", () => {
    const result = inspectArtifactContent(rule({ min_rows: 0 }), Buffer.from("label,count\n"));
    expect(result.findings).toEqual([]);
    expect(result.facts.rows).toBe(0);
    expect(result.facts.integers.get("count")).toBe(0);
  });
  it("parses quotes, comma fields, multiline fields and CRLF without retaining records", () => {
    const result = inspectArtifactContent(rule(), Buffer.from('label,count\r\n"first, second",1\r\n"multi\nline ""quote""",2\r\n'));
    expect(result.findings).toEqual([]);
    expect(result.facts.rows).toBe(2);
    expect(result.facts.integers.get("count")).toBe(3);
  });
  it("accepts safe negative integers without treating them as text formulas", () => {
    expect(inspectArtifactContent(rule(), Buffer.from("label,count\na,-2\n")).findings).toEqual([]);
  });
  it.each([
    ["wrong,count\na,1\n", "artifact.csv-header"],
    ["label,count\na,1,extra\n", "artifact.csv-column-count"],
    ['label,count\n"unfinished,1\n', "artifact.csv-invalid"],
    ['label,count\na"b,1\n', "artifact.csv-invalid"],
    ["label,count\na,1\na,2\n", "artifact.csv-duplicate"],
    ["label,count\n=2+2,1\n", "artifact.csv-formula"],
    ['label,count\n"  @example",1\n', "artifact.csv-formula"],
    ["label,count\n\uff1d2+2,1\n", "artifact.csv-formula"],
    ["label,count\na,9007199254740992\n", "artifact.csv-value"],
    ["label,count\na,9007199254740991\nb,1\n", "artifact.csv-unsafe-sum"],
    ["label,count\na,NaN\n", "artifact.csv-value"],
  ])("rejects invalid CSV with stable codes: %s", (input, code) => {
    expect(inspectArtifactContent(rule(), Buffer.from(input)).findings.some(finding => finding.code === code)).toBe(true);
  });
  it("enforces record limits and UTF-8", () => {
    expect(inspectArtifactContent(rule({ max_rows: 1 }), Buffer.from("label,count\na,1\nb,2\n")).findings[0].code).toBe("artifact.csv-row-limit");
    expect(inspectArtifactContent(rule(), Buffer.from([0xff])).findings[0].code).toBe("artifact.invalid-utf8");
  });
  it("checks actual JSON types and values without exposing private input values", () => {
    const json = parseArtifactContract({ schema: "skillsync.artifacts/v1",
      limits: { max_files: 8, max_file_bytes: 10000, max_total_bytes: 20000 },
      files: [{ path: "data.json", format: "json", fields: [
        { name: "version", type: "integer", equals: 1 }, { name: "count", type: "integer" }] }] }).files[0];
    expect(inspectArtifactContent(json, Buffer.from('{"version":1,"count":2}')).findings).toEqual([]);
    const bad = inspectArtifactContent(json, Buffer.from('{"version":2,"count":"NEVER_DISCLOSE_VALUE"}'));
    expect(bad.findings.some(finding => finding.code === "artifact.json-value")).toBe(true);
    expect(JSON.stringify(bad.findings)).not.toContain("NEVER_DISCLOSE_VALUE");
  });
  it("requires own JSON properties and checks real calendar dates", () => {
    const json = parseArtifactContract({ schema: "skillsync.artifacts/v1",
      limits: { max_files: 8, max_file_bytes: 10000, max_total_bytes: 20000 },
      files: [{ path: "data.json", format: "json", fields: [{ name: "constructor", type: "object" }] }] }).files[0];
    expect(inspectArtifactContent(json, Buffer.from("{}")).findings[0].code).toBe("artifact.json-missing-field");
    const date = rule({ columns: [{ name: "label", type: "date" }, { name: "count", type: "integer" }] });
    expect(inspectArtifactContent(date, Buffer.from("label,count\n2026-02-29,1\n")).findings[0].code).toBe("artifact.csv-value");
    expect(inspectArtifactContent(date, Buffer.from("label,count\n2024-02-29,1\n")).findings).toEqual([]);
  });
  it("rejects unsupported or unsafe contract declarations", () => {
    expect(() => rule({ path: "../outside.csv" })).toThrow("artifact contract is invalid");
    expect(() => rule({ columns: [{ name: "x", type: "string", min: 1 }] })).toThrow("artifact contract is invalid");
    expect(() => rule({ columns: [{ name: "x", type: "string" }, { name: "x", type: "string" }] })).toThrow("artifact contract is invalid");
  });
});
