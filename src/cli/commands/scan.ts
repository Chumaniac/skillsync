import { resolve } from "node:path";

import {
  scanInventory,
  type Inventory,
  type InventoryOptions,
  type ScanTarget,
} from "../../domain/inventory.js";
import type { Finding } from "../../domain/result.js";
import { formatOutput, parseOutputFormat, type OutputFormat } from "../output.js";

export type ScanOptions = InventoryOptions & {
  paths: string[];
};

export type ScanReport = {
  schema_version: 1;
  targets: ScanTarget[];
  skills: Array<{
    name: string;
    rootPath: string;
    skillMdPath: string;
    source: Inventory["skills"][number]["source"];
    digest: string;
    files: Array<Pick<Inventory["skills"][number]["files"][number], "relativePath" | "mode" | "isSymlink">>;
  }>;
  findings: Finding[];
};

function targetForPath(path: string, index: number): ScanTarget {
  return {
    name: `explicit-${index + 1}`,
    path: resolve(path),
    scope: "explicit",
  };
}

export function toScanReport(inventory: Inventory): ScanReport {
  return {
    schema_version: 1,
    targets: inventory.targets,
    skills: inventory.skills.map((skill) => ({
      name: skill.name,
      rootPath: skill.rootPath,
      skillMdPath: skill.skillMdPath,
      source: skill.source,
      digest: skill.digest,
      files: skill.files.map(({ relativePath, mode, isSymlink }) => ({
        relativePath,
        mode,
        isSymlink,
      })),
    })),
    findings: inventory.findings,
  };
}

export async function runScan(options: ScanOptions): Promise<ScanReport> {
  const paths = options.paths.length > 0 ? options.paths : [".agents/skills", ".claude/skills", ".cursor/skills"];
  const targets = paths.map(targetForPath);
  const inventory = await scanInventory(targets, options);
  return toScanReport(inventory);
}

export function renderScan(report: ScanReport, format: string | undefined): string {
  const outputFormat: OutputFormat = parseOutputFormat(format);
  return formatOutput(report, outputFormat);
}
