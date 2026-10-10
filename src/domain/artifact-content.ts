import type { ArtifactFileRule, ArtifactScalarRule } from "./artifact-contract.js";
import { parseStrictJson } from "./strict-json.js";

export type ArtifactFinding = { code: string; path?: string; field?: string | string[]; row?: number; message?: string };
export type ArtifactFacts = { rows?: number; integers: Map<string, number> };
export type ArtifactCellObserver = (field: string, value: string, row: number) => void;
export type ArtifactRowObserver = (values: ReadonlyMap<string, string | number>, dataRecord?: number) => void;

function* csvRows(text: string, maxFields: number): Generator<string[]> {
  let field = "", row: string[] = [], quoted = false, afterQuote = false, active = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    active = true;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; afterQuote = true; }
      } else field += char;
      continue;
    }
    if (afterQuote && char !== "," && char !== "\r" && char !== "\n") throw new Error("invalid csv");
    if (char === '"') {
      if (field || afterQuote) throw new Error("invalid csv");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      if (row.length >= maxFields) throw new Error("csv-column-count");
      field = ""; afterQuote = false;
    }
    else if (char === "\r" || char === "\n") {
      if (char === "\r") {
        if (text[index + 1] !== "\n") throw new Error("invalid csv");
        index += 1;
      }
      row.push(field); yield row; row = []; field = ""; afterQuote = false; active = false;
    } else field += char;
  }
  if (quoted) throw new Error("invalid csv");
  if (active || row.length || field || afterQuote) { row.push(field); yield row; }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validSourceUrl(value: unknown, rule: ArtifactScalarRule): boolean {
  // Parse one bounded scalar; never resolve DNS, fetch a source or retain its value.
  if (typeof value !== "string" || value.length > 2048 || !/^https:\/\//i.test(value) ||
    /[\p{Cc}\p{Cf}\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (rule.allowed_hosts ?? []).includes(url.hostname);
  } catch { return false; }
}

function scalarValid(value: unknown, rule: ArtifactScalarRule): boolean {
  if (rule.type === "integer" && (typeof value !== "number" || !Number.isSafeInteger(value))) return false;
  if (rule.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return false;
  if (rule.type === "string" && (typeof value !== "string" || (!rule.allow_empty && !value.length))) return false;
  if (rule.type === "date" && (typeof value !== "string" || !validDate(value))) return false;
  if (rule.type === "https_url" && !validSourceUrl(value, rule)) return false;
  if (rule.type === "boolean" && typeof value !== "boolean") return false;
  if (rule.type === "array" && !Array.isArray(value)) return false;
  if (rule.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return false;
  // One bounded literal list; do not coerce, normalize, evaluate or retain values.
  if (rule.one_of !== undefined && (typeof value !== "string" || !rule.one_of.includes(value))) return false;
  if (rule.equals !== undefined && value !== rule.equals) return false;
  if (typeof value === "number" && ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max))) return false;
  return true;
}

function csvValue(value: string, rule: ArtifactScalarRule): unknown {
  if (rule.type === "integer" || rule.type === "number") {
    const pattern = rule.type === "integer" ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
    return pattern.test(value) ? Number(value) : undefined;
  }
  if (rule.type === "boolean") return value === "true" ? true : value === "false" ? false : undefined;
  return value;
}

function formula(value: string): boolean {
  return /^[\t\r\n]/.test(value) || /^[=+@\-\uFF1D\uFF0B\uFF0D\uFF20]/.test(value.trimStart());
}

export function inspectArtifactContent(rule: ArtifactFileRule, bytes: Uint8Array, observe?: ArtifactCellObserver, observeRow?: ArtifactRowObserver): { facts: ArtifactFacts; findings: ArtifactFinding[] } {
  const facts: ArtifactFacts = { integers: new Map() }, findings: ArtifactFinding[] = [];
  const issue = (code: string, field?: string, row?: number) => {
    if (findings.length < 64) findings.push({ code, path: rule.path, ...(field ? { field } : {}), ...(row !== undefined ? { row } : {}) });
  };
  if (rule.format === "bytes") return { facts, findings };
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { issue("artifact.invalid-utf8"); return { facts, findings }; }
  if (rule.format === "json") {
    let value: unknown;
    try { value = parseStrictJson(text); } catch { issue("artifact.json-invalid"); return { facts, findings }; }
    if (!value || typeof value !== "object" || Array.isArray(value)) { issue("artifact.json-root"); return { facts, findings }; }
    const object = value as Record<string, unknown>;
    if (!rule.allow_extra_fields && Object.keys(object).some(key => !rule.fields.some(field => field.name === key))) issue("artifact.json-extra-field");
    for (const field of rule.fields) {
      if (!Object.hasOwn(object, field.name)) { if (field.required) issue("artifact.json-missing-field", field.name); continue; }
      if (!scalarValid(object[field.name], field)) issue("artifact.json-value", field.name);
      else if (field.type === "integer") facts.integers.set(field.name, object[field.name] as number);
    }
    return { facts, findings };
  }
  let count = 0;
  for (const column of rule.columns) if (column.type === "integer") facts.integers.set(column.name, 0);
  const keys = new Set<string>();
  const uniqueIndexes = rule.unique_by.map(name => rule.columns.findIndex(column => column.name === name));
  try {
    const records = csvRows(text, rule.columns.length);
    const header = records.next().value as string[] | undefined;
    if (!header || header.length !== rule.columns.length || header.some((name, index) => name !== rule.columns[index].name)) {
      issue("artifact.csv-header"); return { facts, findings };
    }
    if (rule.reject_formulas && header.some(formula)) issue("artifact.csv-formula", undefined, 0);
    for (const row of records) {
      count += 1;
      if (count > rule.max_rows) { issue("artifact.csv-row-limit"); break; }
      if (row.length !== rule.columns.length) { issue("artifact.csv-column-count", undefined, count); continue; }
      if (uniqueIndexes.length) {
        const key = JSON.stringify(uniqueIndexes.map(index => row[index]));
        if (keys.has(key)) issue("artifact.csv-duplicate", undefined, count);
        keys.add(key);
      }
      const values = observeRow ? new Map<string, string | number>() : undefined;
      for (const [index, column] of rule.columns.entries()) {
        const value = csvValue(row[index], column);
        const riskyFormula = rule.reject_formulas && ["string", "date"].includes(column.type) && formula(row[index]);
        if (riskyFormula) issue("artifact.csv-formula", column.name, count);
        if (!scalarValid(value, column)) { issue("artifact.csv-value", column.name, count); continue; }
        if (!riskyFormula && (typeof value === "string" || typeof value === "number")) values?.set(column.name, value);
        if (!riskyFormula && column.type === "string") observe?.(column.name, value as string, count);
        if (column.type === "integer") {
          const total = (facts.integers.get(column.name) ?? 0) + (value as number);
          if (!Number.isSafeInteger(total)) issue("artifact.csv-unsafe-sum", column.name, count);
          else facts.integers.set(column.name, total);
        }
      }
      if (values) observeRow?.(values, count);
    }
    facts.rows = count;
    if (count < rule.min_rows) issue("artifact.csv-too-few-rows");
  } catch (error) { issue(error instanceof Error && error.message === "csv-column-count" ? "artifact.csv-column-count" : "artifact.csv-invalid"); }
  return { facts, findings };
}
