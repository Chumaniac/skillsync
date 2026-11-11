export type OutputFormat = "text" | "json" | "sarif";

import { redactLocalPaths } from "../reporters/local-paths.js";

export function parseOutputFormat(value: unknown): OutputFormat {
  if (value === undefined || value === "text") {
    return "text";
  }
  if (value === "json" || value === "sarif") {
    return value;
  }
  throw new Error(`Unsupported output format: ${String(value)}`);
}

export function formatOutput(value: unknown, format: OutputFormat = "text"): string {
  const safeValue = redactLocalPaths(value);
  if (format === "json") {
    return `${JSON.stringify(safeValue, null, 2)}\n`;
  }

  if (format === "sarif") {
    return `${JSON.stringify(
      {
        version: "2.1.0",
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        runs: [],
      },
      null,
      2,
    )}\n`;
  }

  return typeof value === "string"
    ? `${safeValue}\n`
    : `${JSON.stringify(safeValue, null, 2)}\n`;
}
