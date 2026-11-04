import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/domain/result.js";
import { renderJUnit } from "../../src/reporters/junit.js";

const finding = (status: Finding["status"], changes: Partial<Finding> = {}): Finding => ({
  level: 2, severity: "error", status, code: "synthetic.check", skill: "example",
  message: "Synthetic finding", evidence: [], ...changes,
});

describe("JUnit evidence output", () => {
  it("keeps findings and policy outcomes distinct, escapes XML and omits raw evidence", () => {
    const output = renderJUnit({ findings: [finding("pass"), finding("warn"), finding("unknown"),
      finding("fail", { code: 'bad<&"', skill: "/private/example/project", message: "bad <node> & value\u0000\ud800😀",
        evidence: [{ raw: "NEVER_REPORT_RAW_SLOT" }] })], exitCode: 1 }, "verify");
    expect(output).toContain('tests="5" failures="2" errors="0" skipped="2"');
    expect(output.match(/<testcase /g)).toHaveLength(5);
    expect(output).toContain("bad&lt;&amp;&quot;");
    expect(output).toContain("bad &lt;node&gt; &amp; value");
    expect(output).toContain("😀");
    expect(output).not.toContain("/private/example/project");
    expect(output).not.toContain("NEVER_REPORT_RAW_SLOT");
    expect(output).not.toContain("\u0000");
    expect(output).not.toContain("\ud800");
    expect(output).not.toContain("<!DOCTYPE");
  });

  it("represents empty inventory honestly and fails before unbounded report output", () => {
    expect(renderJUnit({ findings: [] }, "scan")).toContain('tests="1" failures="0" errors="0" skipped="0"');
    expect(renderJUnit({ findings: [], exitCode: 2 }, "verify")).toContain("<error ");
    expect(() => renderJUnit({ findings: Array.from({ length: 10001 }, () => finding("pass")) }, "scan")).toThrow(/capacity/i);
    expect(() => renderJUnit({ findings: Array.from({ length: 3000 }, () => finding("fail", { message: "x".repeat(2048) })) }, "verify")).toThrow(/capacity/i);
  });
});
