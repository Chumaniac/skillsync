import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { parseArtifactContract, type ArtifactDeclarations } from "../../domain/artifact-contract.js";
import { parseStrictJson } from "../../domain/strict-json.js";
import { inspectArtifactContent, type ArtifactFacts, type ArtifactFinding, type ArtifactRowObserver } from "../../domain/artifact-content.js";
import { createArtifactReferenceIndex } from "../../domain/artifact-references.js";
import { createArtifactReconciliationIndex, type ReconciliationSummary } from "../../domain/artifact-reconciliation.js";
import { artifactSetHash, compareArtifactReports, parseArtifactReport, type ArtifactComparison } from "../../domain/artifact-report-comparison.js";
import { redactLocalPaths } from "../../reporters/local-paths.js";
import { renderArtifactsHtml } from "../../reporters/artifacts-html.js";
import { readDirectoryEntries, readWorkspaceFile, scanStagedWorkspace, WorkspaceTreeError } from "../../sandbox/workspace-tree.js";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema = z.object({ schema: z.literal("skilltape.dev/delivery/v1"),
  run_id: sha, skill_hash: sha, receipt_sha256: sha, artifact_set_sha256: sha,
  files: z.array(z.object({ path: z.string().min(1).max(1024), bytes: z.number().int().min(0).max(16 * 1024 * 1024), sha256: sha }).strict()).max(10_000),
}).strict();

export type ArtifactsOptions = { contract: string; delivery?: string; path?: string; includeRowEvidence?: boolean; compare?: string };
export type ArtifactReport = {
  schema: "skillsync.artifacts-report/v1"; status: "passed" | "failed"; exitCode: number;
  evidence: "physical-files"; execution: "not-run"; provenance: "not-authenticated";
  receipt_binding: "verified" | "not-provided" | "failed";
  contract_sha256?: string; artifact_set_sha256?: string;
  files: Array<{ path: string; bytes: number; sha256: string; rows?: number }>;
  findings: ArtifactFinding[];
  reconciliations?: ReconciliationSummary[];
  declarations?: ArtifactDeclarations;
  comparison?: ArtifactComparison;
};

function readJson(bytes: Uint8Array): unknown {
  return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function runArtifacts(options: ArtifactsOptions): Promise<ArtifactReport> {
  if (!options.compare) return inspectArtifacts(options);
  let before: ArtifactReport, bytes: Uint8Array;
  try {
    bytes = await readWorkspaceFile(options.compare, 1024 * 1024);
    before = parseArtifactReport(readJson(bytes));
  } catch {
    return { schema: "skillsync.artifacts-report/v1", status: "failed", exitCode: 2,
      evidence: "physical-files", execution: "not-run", provenance: "not-authenticated",
      receipt_binding: "not-provided", files: [], findings: [{ code: "artifact.baseline-invalid" }] };
  }
  const report = await inspectArtifacts(options);
  report.comparison = compareArtifactReports(before, report, hash(bytes));
  if (report.comparison.status === "unavailable") {
    report.status = "failed"; report.exitCode = 2;
    if (report.findings.length < 256) report.findings.push({ code: "artifact.baseline-unavailable" });
  }
  return report;
}

async function inspectArtifacts(options: ArtifactsOptions): Promise<ArtifactReport> {
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
    // Only validated cross-file metadata is included; scalar expected values and raw cells are omitted.
    report.declarations = { limits: { ...contract.limits }, checks: contract.checks.map((check, index) => ({ ordinal: index + 1, check })) };
  } catch { issue("artifact.contract-invalid"); report.exitCode = 2; return report; }
  let root = options.path ?? join(options.delivery!, "artifacts");
  try {
    const selected = await lstat(options.delivery ?? root);
    if (!selected.isDirectory() || selected.isSymbolicLink()) throw new Error("directory invalid");
  } catch {
    issue("artifact.directory-invalid"); report.exitCode = 2; return report;
  }
  let manifest: z.infer<typeof manifestSchema> | undefined;
  let metadataHashes: { receipt: string; manifest: string } | undefined;
  if (options.delivery) {
    try {
      const entries = (await readDirectoryEntries(options.delivery, 4)).map(entry => entry.name);
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
  const reconciliation = createArtifactReconciliationIndex(contract, { rowEvidence: options.includeRowEvidence });
  try {
    const rules = new Map(contract.files.map(file => [file.path, file]));
    const tree = await scanStagedWorkspace(root, {
      limits: { maxFiles: contract.limits.max_files, maxFileBytes: contract.limits.max_file_bytes, maxTotalBytes: contract.limits.max_total_bytes },
      allowedFiles: new Set(rules.keys()),
      inspectFile(path, content, observation) {
        const rule = rules.get(path)!;
        const sha256 = observation.digest.slice("sha256:".length);
        if (rule.sha256 && rule.sha256 !== sha256) { issue("artifact.digest-mismatch", path); reconciliation.invalidate(path); }
        const referenceRows = references.rowObserver(path), reconciliationRows = reconciliation.observer(path);
        const observeRow: ArtifactRowObserver | undefined = referenceRows || reconciliationRows ? (values, row) => {
          referenceRows?.(values, row); reconciliationRows?.(values, row);
        } : undefined;
        const inspected = inspectArtifactContent(rule, content, references.observer(path), observeRow);
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
  report.artifact_set_sha256 = artifactSetHash(report.files);
  if (manifest) {
    if (manifest.artifact_set_sha256 !== report.artifact_set_sha256) issue("delivery.artifact-set-digest");
    for (const file of report.files) {
      const declared = manifest.files.find(entry => entry.path === file.path)!;
      if (declared.bytes !== file.bytes || declared.sha256 !== file.sha256) issue("delivery.artifact-digest", file.path);
    }
    try {
      const entries = (await readDirectoryEntries(options.delivery!, 4)).map(entry => entry.name);
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
  if (format === "html") return renderArtifactsHtml(report);
  const safe = redactLocalPaths(report);
  if (format === "json") return JSON.stringify(safe, null, 2) + "\n";
  return [`Artifact validation: ${safe.status}`, `Evidence: physical files; execution: not-run; receipt binding: ${safe.receipt_binding}`,
    ...(safe.comparison ? [`Baseline comparison: ${safe.comparison.status}${safe.comparison.reason ? `; ${safe.comparison.reason}` : ""}`,
      ...(safe.comparison.findings ? [`Finding categories: ${safe.comparison.findings.added} new; ${safe.comparison.findings.ongoing} ongoing; ${safe.comparison.findings.resolved} resolved`] : [])] : []),
    ...(safe.comparison?.checks ? [`Record check changes: ${safe.comparison.checks.filter(check => check.change === "improved").length} improved; ${safe.comparison.checks.filter(check => check.change === "regressed").length} regressed; ${safe.comparison.checks.filter(check => check.change === "changed").length} mixed changes; ${safe.comparison.checks.filter(check => check.change === "unchanged").length} unchanged`] : []),
    ...(safe.declarations ? [`Declared cross-file checks: ${safe.declarations.checks.length}`, `Inspection limits: ${JSON.stringify(safe.declarations.limits)}`, ...safe.declarations.checks.map(item => `Declaration ${item.ordinal}: ${JSON.stringify(item.check)}`)] : ["Declaration metadata: unavailable in this snapshot"]),
    `Files: ${safe.files.length}`, ...(safe.reconciliations ?? []).map(item => `Record reconciliation: ${item.status}${item.status !== "unknown" ? `; source keys=${item.sourceKeys}; target keys=${item.targetKeys}; missing=${item.missingKeys}; unexpected=${item.unexpectedKeys}; mismatched values=${item.valueMismatches}` : ""}`),
    ...safe.findings.map(finding => `${finding.code}${finding.path ? ` file=${JSON.stringify(finding.path)}` : ""}${finding.field ? ` field=${JSON.stringify(finding.field)}` : ""}${finding.row !== undefined ? ` row=${finding.row}` : ""}${finding.reference ? ` reference=${JSON.stringify(finding.reference)}` : ""}${finding.message ? ` ${finding.message}` : ""}`)].join("\n") + "\n";
}
