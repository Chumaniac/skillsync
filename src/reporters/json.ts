import type { VerificationReport } from "../cli/commands/verify.js";
import { redactLocalPaths } from "./local-paths.js";

export function renderJson(report: VerificationReport): string {
  const safeReport = redactLocalPaths(report, {
    includeLocalPaths: report.reporting?.include_local_paths,
  });
  return `${JSON.stringify(safeReport, null, 2)}\n`;
}
