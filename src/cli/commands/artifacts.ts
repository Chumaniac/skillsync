import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { parseArtifactContract } from "../../domain/artifact-contract.js";
import { parseStrictJson } from "../../domain/strict-json.js";
import { inspectArtifactContent, type ArtifactFacts, type ArtifactFinding } from "../../domain/artifact-content.js";
import { createArtifactReferenceIndex } from "../../domain/artifact-references.js";
import { createArtifactReconciliationIndex, type ReconciliationSummary } from "../../domain/artifact-reconciliation.js";
import { redactLocalPaths } from "../../reporters/local-paths.js";
import { readWorkspaceFile, scanStagedWorkspace, WorkspaceTreeError } from "../../sandbox/workspace-tree.js";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema = z.object({ schema: z.literal("skilltape.dev/delivery/v1"),
  run_id: sha, skill_hash: sha, receipt_sha256: sha, artifact_set_sha256: sha,
  files: z.array(z.object({ path: z.string().min(1).max(1024), bytes: z.number().int().min(0).max(16 * 1024 * 1024), sha256: sha }).strict()).max(10_000),
}).strict();

export type ArtifactsOptions = { contract: string; delivery?: string; path?: string };
export type ArtifactReport = {
  schema: "skillsync.artifacts-report/v1"; status: "passed" | "failed"; exitCode: number;
  evidence: "physical-files"; execution: "not-run"; provenance: "not-authenticated";
  receipt_binding: "verified" | "not-provided" | "failed";
  contract_sha256?: string; artifact_set_sha256?: string;
  files: Array<{ path: string; bytes: number; sha256: string; rows?: number }>;
  findings: ArtifactFinding[];
  reconciliations?: ReconciliationSummary[];
};

function setHash(files: ArtifactReport["files"]): string {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))) {
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(file.bytes));
    digest.update(file.path); digest.update(Buffer.from([0])); digest.update(size); digest.update(file.sha256);
  }
  return digest.digest("hex");
}

function readJson(bytes: Uint8Array): unknown {
  return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function runArtifacts(options: ArtifactsOptions): Promise<ArtifactReport> {
  const report: ArtifactReport = { schema: "skillsync.artifacts-report/v1", status: "failed", exitCode: 1,
    evidence: "physical-files", execution: "not-run", provenance: "not-authenticated",
    receipt_binding: options.delivery ? "failed" : "not-provided", files: [], findings: [] };
  const issue = (code: string, path?: string, field?: string) => {
    if (report.findings.length < 256) report.findings.push({ code, ...(path ? { path } : {}), ...(field ? { field } : {}) });
  };
  let contract;
  try {
    if (Boolean(options.delivery) === Boolean(options.path)) throw new Error("select one directory");
    const bytes = await readWorkspaceFile(options.contract, 64 * 1024);
    contract = parseArtifactContract(parseYaml(new TextDecoder("utf-8", { fatal: true }).decode(bytes), { maxAliasCount: 100, prettyErrors: false, logLevel: "silent" }));
    report.contract_sha256 = hash(JSON.stringify(contract));
  } catch { issue("artifact.contract-invalid"); report.exitCode = 2; return report; }
  let root = options.path ?? join(options.delivery!, "artifacts");
  let manifest: z.infer<typeof manifestSchema> | undefined;
  let metadataHashes: { receipt: string; manifest: string } | undefined;
  if (options.delivery) {
    try {
      const metadata = await lstat(options.delivery);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("directory invalid");
      const entries = await readdir(options.delivery);
      if (entries.length !== 3 || !["artifacts", "receipt.json", "delivery.json"].every(name => entries.includes(name))) {
        issue("delivery.layout"); return report;
      }
      const manifestBytes = await readWorkspaceFile(join(options.delivery, "delivery.json"), 1024 * 1024);
      const result = manifestSchema.safeParse(readJson(manifestBytes));
      if (!result.success) { issue("delivery.manifest-invalid"); return report; }
      manifest = result.data;
      const expected = new Set(contract.files.map(file => file.path));
      if (manifest.files.length !== expected.size || new Set(manifest.files.map(file => file.path)).size !== manifest.files.length ||
        manifest.files.some((file, index) => index > 0 && Buffer.compare(Buffer.from(manifest!.files[index - 1].path), Buffer.from(file.path)) >= 0) ||
        manifest.files.some(file => !expected.has(file.path))) { issue("delivery.file-set"); return report; }
      const receiptBytes = await readWorkspaceFile(join(options.delivery, "receipt.json"), 1024 * 1024);
      const receipt = readJson(receiptBytes) as Record<string, unknown>;
      if (!receipt || receipt.schema !== "skilltape.dev/receipt/v1" || receipt.status !== "succeeded" ||
        receipt.run_id !== manifest.run_id || receipt.skill_hash !== manifest.skill_hash || hash(receiptBytes) !== manifest.receipt_sha256) {
        issue("delivery.receipt-binding"); return report;
      }
      report.receipt_binding = "verified";
      metadataHashes = { receipt: hash(receiptBytes), manifest: hash(manifestBytes) };
    } catch { issue("delivery.metadata-invalid"); return report; }
    root = join(options.delivery, "artifacts");
  }
  const facts = new Map<string, ArtifactFacts>();
  const references = createArtifactReferenceIndex(contract);
  const reconciliation = createArtifactReconciliationIndex(contract);
  try {
    const rules = new Map(contract.files.map(file => [file.path, file]));
    const tree = await scanStagedWorkspace(root, {
      limits: { maxFiles: contract.limits.max_files, maxFileBytes: contract.limits.max_file_bytes, maxTotalBytes: contract.limits.max_total_bytes },
      allowedFiles: new Set(rules.keys()),
      inspectFile(path, content, observation) {
        const rule = rules.get(path)!;
        const sha256 = observation.digest.slice("sha256:".length);
        if (rule.sha256 && rule.sha256 !== sha256) { issue("artifact.digest-mismatch", path); reconciliation.invalidate(path); }
        const inspected = inspectArtifactContent(rule, content, references.observer(path), reconciliation.observer(path));
        if (inspected.findings.length) reconciliation.invalidate(path);
        facts.set(path, inspected.facts);
        for (const finding of inspected.findings) if (report.findings.length < 256) report.findings.push(finding);
        report.files.push({ path, bytes: observation.bytes, sha256, ...(inspected.facts.rows !== undefined ? { rows: inspected.facts.rows } : {}) });
      },
    });
    const found = new Set(tree.files.map(file => file.path.slice("workspace/".length)));
    for (const file of contract.files) if (!found.has(file.path)) { issue("artifact.missing", file.path); reconciliation.invalidate(file.path); }
  } catch (error) {
    report.files = [];
    report.findings = [];
    issue(error instanceof WorkspaceTreeError && error.code === "workspace.tree-too-large" ? "artifact.capacity" : "artifact.structure-or-snapshot");
    if (error instanceof WorkspaceTreeError) report.findings.at(-1)!.message = error.message;
    return report;
  }
  report.files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  report.artifact_set_sha256 = setHash(report.files);
  if (manifest) {
    if (manifest.artifact_set_sha256 !== report.artifact_set_sha256) issue("delivery.artifact-set-digest");
    for (const file of report.files) {
      const declared = manifest.files.find(entry => entry.path === file.path)!;
      if (declared.bytes !== file.bytes || declared.sha256 !== file.sha256) issue("delivery.artifact-digest", file.path);
    }
    try {
      const entries = await readdir(options.delivery!);
      if (entries.length !== 3 || !["artifacts", "receipt.json", "delivery.json"].every(name => entries.includes(name)) ||
        hash(await readWorkspaceFile(join(options.delivery!, "receipt.json"), 1024 * 1024)) !== metadataHashes!.receipt ||
        hash(await readWorkspaceFile(join(options.delivery!, "delivery.json"), 1024 * 1024)) !== metadataHashes!.manifest) issue("delivery.changed-during-check");
    } catch { issue("delivery.changed-during-check"); }
  }
  for (const check of contract.checks) {
    if (check.type !== "csv_summary") continue;
    const csv = facts.get(check.csv), json = facts.get(check.json);
    if (!csv || !json) { issue("artifact.comparison-missing", check.csv); continue; }
    if (csv.rows !== json.integers.get(check.row_count_field)) issue("artifact.summary-row-count", check.json, check.row_count_field);
    for (const sum of check.sums) if (csv.integers.get(sum.column) !== json.integers.get(sum.field)) issue("artifact.summary-sum", check.json, sum.field);
  }
  for (const finding of references.findings()) if (report.findings.length < 256) report.findings.push(finding);
  const reconciled = reconciliation.finish();
  if (reconciled.summaries.length) report.reconciliations = reconciled.summaries;
  for (const finding of reconciled.findings) if (report.findings.length < 256) report.findings.push(finding);
  if (!report.findings.length) { report.status = "passed"; report.exitCode = 0; }
  return report;
}

export function renderArtifacts(report: ArtifactReport, format = "text"): string {
  const safe = redactLocalPaths(report);
  if (format === "json") return JSON.stringify(safe, null, 2) + "\n";
  return [`Artifact validation: ${safe.status}`, `Evidence: physical files; execution: not-run; receipt binding: ${safe.receipt_binding}`,
    `Files: ${safe.files.length}`, ...(safe.reconciliations ?? []).map(item => `Record reconciliation: ${item.status}${item.status !== "unknown" ? `; source keys=${item.sourceKeys}; target keys=${item.targetKeys}; missing=${item.missingKeys}; unexpected=${item.unexpectedKeys}; mismatched values=${item.valueMismatches}` : ""}`),
    ...safe.findings.map(finding => `${finding.code}${finding.path ? ` file=${JSON.stringify(finding.path)}` : ""}${finding.field ? ` field=${JSON.stringify(finding.field)}` : ""}${finding.row !== undefined ? ` row=${finding.row}` : ""}${finding.message ? ` ${finding.message}` : ""}`)].join("\n") + "\n";
}
