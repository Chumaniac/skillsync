import type { Finding } from "../domain/result.js";
import { redactLocalPaths } from "./local-paths.js";

type JUnitReport = {
  findings: Finding[];
  exitCode?: number;
  reporting?: { include_local_paths?: boolean };
};

const MAX_CASES = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

function xml(value: string): string {
  let safe = "";
  for (const character of value.slice(0, 2048)) {
    const point = character.codePointAt(0)!;
    safe += point === 9 || point === 10 || point === 13 ||
      point >= 0x20 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd ||
      point >= 0x10000 && point <= 0x10ffff ? character : "�";
  }
  if (value.length > 2048) safe += "…";
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  return safe.replace(/[&<>"']/g, character => entities[character]);
}

/** Static checks only. Raw evidence and source contents never enter this format. */
export function renderJUnit(report: JUnitReport, command: "verify" | "scan"): string {
  const gate = report.exitCode !== undefined || report.findings.length === 0;
  const total = report.findings.length + Number(gate);
  if (total > MAX_CASES) throw new Error("JUnit report capacity exceeded");
  if (report.exitCode !== undefined && (!Number.isInteger(report.exitCode) || report.exitCode < 0 || report.exitCode > 4)) {
    throw new Error("Invalid JUnit policy exit code");
  }
  let failures = 0, skipped = 0;
  for (const finding of report.findings) {
    switch (finding.status) {
      case "fail": failures++; break;
      case "warn": case "unknown": skipped++; break;
      case "pass": break;
      default: throw new Error("Invalid JUnit finding status");
    }
  }
  const policyFailed = report.exitCode !== undefined && report.exitCode !== 0;
  const errors = Number(report.exitCode === 2);
  if (policyFailed && !errors) failures++;
  const parts: string[] = [];
  let bytes = 0;
  const append = (part: string) => {
    bytes += Buffer.byteLength(part, "utf8");
    if (bytes > MAX_BYTES) throw new Error("JUnit report capacity exceeded");
    parts.push(part);
  };
  append(`<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="SkillSync ${command}" tests="${total}" failures="${failures}" errors="${errors}" skipped="${skipped}">\n`);
  append('<properties><property name="skill_execution" value="not-run"/></properties>\n');
  for (const [index, finding] of report.findings.entries()) {
    const safe = redactLocalPaths({ code: finding.code, skill: finding.skill, target: finding.target,
      message: finding.message, remediation: finding.remediation }, { includeLocalPaths: report.reporting?.include_local_paths === true });
    const name = `${safe.code} :: ${safe.skill}${safe.target ? ` (${safe.target})` : ""} #${index + 1}`;
    append(`<testcase classname="skillsync.${command}" name="${xml(name)}">`);
    if (finding.status === "fail") {
      append(`<failure type="${xml(safe.code)}" message="${xml(safe.message)}">${xml(safe.remediation ?? safe.message)}</failure>`);
    } else if (finding.status === "warn" || finding.status === "unknown") {
      append(`<skipped message="${xml(finding.status + ": " + safe.message)}"/>`);
    }
    append("</testcase>\n");
  }
  if (gate) {
    append(`<testcase classname="skillsync.${command}" name="${report.exitCode === undefined ? "inventory-completed" : "verification-policy"}">`);
    if (policyFailed) {
      const kind = errors ? "error" : "failure";
      append(`<${kind} type="policy-exit" message="Verification exit code ${report.exitCode}"/>`);
    }
    append("</testcase>\n");
  }
  append("</testsuite>\n");
  return parts.join("");
}
