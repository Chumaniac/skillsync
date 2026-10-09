import { z } from "zod";

import { WORKSPACE_TREE_LIMITS } from "../sandbox/workspace-tree.js";

const safePath = z.string().min(1).max(1024).refine(path =>
  !path.startsWith("/") && !path.includes("\\") && !/\p{Cc}/u.test(path) &&
  !/^[A-Za-z]:/.test(path) && path.split("/").every(part => part && part !== "." && part !== ".."),
"artifact paths must be safe and relative");
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const allowedHost = z.string().min(3).max(253).regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/,
  "source hosts must be exact lowercase DNS names",
);
const scalar = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(["string", "integer", "number", "boolean", "date", "https_url", "array", "object"]),
  allowed_hosts: z.array(allowedHost).min(1).max(16).optional(),
  one_of: z.array(z.string().max(256).refine(value => value === value.trim() &&
    !/[\p{Cc}\p{Cf}]/u.test(value), "options must be exact plain strings")).min(1).max(32).optional(),
  required: z.boolean().default(true),
  equals: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
  min: z.number().finite().optional(), max: z.number().finite().optional(),
  allow_empty: z.boolean().default(false),
}).strict().refine(rule => rule.min === undefined || rule.max === undefined || rule.min <= rule.max,
"minimum must not exceed maximum");
const base = { path: safePath, sha256: hash.optional() };
const csv = z.object({ ...base, format: z.literal("csv"), columns: z.array(scalar).min(1).max(128),
  min_rows: z.number().int().min(0).default(1), max_rows: z.number().int().min(1).max(100_000),
  unique_by: z.array(z.string().min(1)).max(128).default([]),
  reject_formulas: z.boolean().default(true),
}).strict();
const json = z.object({ ...base, format: z.literal("json"), fields: z.array(scalar).max(128).default([]),
  allow_extra_fields: z.boolean().default(false),
}).strict();
const bytes = z.object({ ...base, format: z.literal("bytes") }).strict();
const comparison = z.object({ type: z.literal("csv_summary"), csv: safePath, json: safePath,
  row_count_field: z.string().min(1).max(128),
  sums: z.array(z.object({ column: z.string().min(1).max(128), field: z.string().min(1).max(128) }).strict()).max(128),
}).strict();
const referenceField = z.object({ path: safePath, field: z.string().min(1).max(128) }).strict();
const reference = z.object({ type: z.literal("reference_exists"), source: referenceField, target: referenceField,
  require_all_targets: z.boolean().optional(),
}).strict();

export const artifactContractSchema = z.object({ schema: z.literal("skillsync.artifacts/v1"),
  limits: z.object({
    max_files: z.number().int().positive().max(WORKSPACE_TREE_LIMITS.maxFiles),
    max_file_bytes: z.number().int().positive().max(WORKSPACE_TREE_LIMITS.maxFileBytes),
    max_total_bytes: z.number().int().positive().max(WORKSPACE_TREE_LIMITS.maxTotalBytes),
  }).strict(),
  files: z.array(z.discriminatedUnion("format", [bytes, csv, json])).max(WORKSPACE_TREE_LIMITS.maxFiles),
  checks: z.array(z.discriminatedUnion("type", [comparison, reference])).max(128).default([]),
}).strict().superRefine((contract, context) => {
  const fail = () => context.addIssue({ code: z.ZodIssueCode.custom, message: "inconsistent artifact declarations" });
  const files = new Map(contract.files.map(file => [file.path, file]));
  if (files.size !== contract.files.length || contract.files.length > contract.limits.max_files) fail();
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) if (files.has(parts.slice(0, index).join("/"))) fail();
  }
  for (const file of contract.files) {
    const rules = file.format === "csv" ? file.columns : file.format === "json" ? file.fields : [];
    if (new Set(rules.map(rule => rule.name)).size !== rules.length) fail();
    for (const rule of rules) {
      if (rule.one_of !== undefined && (rule.type !== "string" ||
        new Set(rule.one_of).size !== rule.one_of.length ||
        (!rule.allow_empty && rule.one_of.includes("")) ||
        (rule.equals !== undefined && (typeof rule.equals !== "string" || !rule.one_of.includes(rule.equals))))) fail();
      if (rule.type === "https_url" ? !rule.allowed_hosts ||
        new Set(rule.allowed_hosts).size !== rule.allowed_hosts.length : rule.allowed_hosts !== undefined) fail();
      if ((rule.min !== undefined || rule.max !== undefined) && !["integer", "number"].includes(rule.type)) fail();
      if (rule.equals !== undefined && ((rule.type === "integer" && !Number.isSafeInteger(rule.equals)) ||
        (rule.type === "number" && typeof rule.equals !== "number") ||
        (["string", "date", "https_url"].includes(rule.type) && typeof rule.equals !== "string") ||
        (rule.type === "boolean" && typeof rule.equals !== "boolean") || ["array", "object"].includes(rule.type))) fail();
    }
    if (file.format === "csv" && (file.min_rows > file.max_rows ||
      file.columns.some(rule => ["array", "object"].includes(rule.type) || !rule.required) ||
      file.unique_by.some(name => !file.columns.some(column => column.name === name)))) fail();
  }
  for (const check of contract.checks) {
    if (check.type === "reference_exists") {
      const source = files.get(check.source.path), target = files.get(check.target.path);
      if (source?.format !== "csv" || target?.format !== "csv") { fail(); continue; }
      const sourceColumn = source.columns.find(column => column.name === check.source.field);
      const targetColumn = target.columns.find(column => column.name === check.target.field);
      // Exact nonempty string IDs only; a component of a composite key is not unique.
      if (sourceColumn?.type !== "string" || targetColumn?.type !== "string" ||
        sourceColumn.allow_empty || targetColumn.allow_empty ||
        target.unique_by.length !== 1 || target.unique_by[0] !== check.target.field) fail();
      continue;
    }
    const csv = files.get(check.csv), json = files.get(check.json);
    if (csv?.format !== "csv" || json?.format !== "json") { fail(); continue; }
    const integerField = (name: string) => json.fields.some(field => field.name === name && field.type === "integer" && field.required);
    if (!integerField(check.row_count_field) || check.sums.some(sum =>
      !csv.columns.some(column => column.name === sum.column && column.type === "integer") || !integerField(sum.field))) fail();
  }
});

export type ArtifactContract = z.infer<typeof artifactContractSchema>;
export type ArtifactFileRule = ArtifactContract["files"][number];
export type ArtifactScalarRule = z.infer<typeof scalar>;

export function parseArtifactContract(value: unknown): ArtifactContract {
  const result = artifactContractSchema.safeParse(value);
  if (!result.success) throw new Error("artifact contract is invalid");
  return result.data;
}
