import { parseSkillDocument } from "../src/domain/frontmatter";

export type Severity = "error" | "warning" | "info";
export type DocumentLocation = { start: number; end: number; line: number; column: number };
export type Diagnostic = { severity: Severity; code: string; message: string; location?: DocumentLocation };
export type Field = { key: string; value: string; structured: boolean };
export type Inspection = {
  state: "error" | "warning" | "valid";
  diagnostics: Diagnostic[];
  fields: Field[];
  /** Safe relative resources the document links to. Only the CLI can confirm they exist. */
  references: string[];
  body?: { characters: number; lines: number };
};

export const BYTE_LIMIT = 24 * 1024;
// Naming and length conventions shared by Agent Skills hosts. The CLI does not fail on
// them, so they are reported as warnings rather than errors.
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_LIMIT = 64;
const DESCRIPTION_LIMIT = 1024;

const PARSER_MESSAGES: Record<string, string> = {
  "Skill document must start with a YAML frontmatter delimiter.": "文档必须以单独一行的 --- 开头。",
  "Skill frontmatter closing delimiter is missing.": "缺少结束文档头的 --- 行。",
  "Skill frontmatter must be a YAML mapping.": "文档头必须是「键: 值」形式的 YAML 映射。",
};

const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).length;

function locate(text: string, start: number, end = start): DocumentLocation {
  const lines = text.slice(0, start).split("\n");
  return { start, end, line: lines.length, column: Array.from(lines[lines.length - 1] ?? "").length + 1 };
}

/** Points at a top-level frontmatter key, or at the opening delimiter when the key is absent. */
function keyLocation(text: string, frontmatterEnd: number, key: string): DocumentLocation {
  const match = new RegExp(`^${key}[ \\t]*:.*$`, "m").exec(text.slice(0, frontmatterEnd));
  return match ? locate(text, match.index, match.index + match[0].length) : locate(text, 0, 3);
}

function isExternalReference(reference: string): boolean {
  return reference.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference);
}

function referencePath(reference: string): string {
  const firstToken = reference.trim().replace(/^<|>$/g, "").split(/\s+/, 1)[0] ?? "";
  return firstToken.split(/[?#]/, 1)[0] ?? "";
}

/**
 * Same outcome as normalizeRelativePath in src/domain/digest.ts, which cannot be bundled
 * for the browser because it also imports node:crypto. Returns undefined for a path the
 * CLI rejects as leaving the Skill root. tests/browser/inspect.test.ts keeps the two aligned.
 */
export function normalizeReference(input: string): string | undefined {
  if (input.includes("\0")) return undefined;
  const normalized = input.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return undefined;
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return undefined;
    segments.push(segment);
  }
  return segments.length ? segments.join("/") : undefined;
}

function describeValue(value: unknown): Field["value"] {
  if (typeof value === "string") return value;
  if (value === null) return "（空）";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `（列表，${value.length} 项）`;
  return "（结构化字段）";
}

function finish(diagnostics: Diagnostic[], rest: Omit<Inspection, "state" | "diagnostics">): Inspection {
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  diagnostics.sort((a, b) => order[a.severity] - order[b.severity] || (a.location?.start ?? 0) - (b.location?.start ?? 0));
  const state = diagnostics.some(item => item.severity === "error") ? "error"
    : diagnostics.some(item => item.severity === "warning") ? "warning" : "valid";
  return { state, diagnostics, ...rest };
}

/** Checks one SKILL.md text. Reads nothing else: no files, no network, no execution. */
export function inspectDocument(text: string): Inspection {
  if (text.length > BYTE_LIMIT || byteLength(text) > BYTE_LIMIT) {
    return finish([{ severity: "error", code: "document.too-large", message: "文档过大：最多可检查 24 KiB。请缩短文档后重试。" }], { fields: [], references: [] });
  }
  const parsed = parseSkillDocument(text);
  if (!parsed.ok) {
    const message = PARSER_MESSAGES[parsed.error] ?? parsed.error.replace(/^Invalid YAML frontmatter: /, "YAML 文档头无效：").replace(/Map keys must be unique$/, "同一个键出现了多次。");
    return finish([{ severity: "error", code: "structure.invalid-frontmatter", message, ...(parsed.location && { location: parsed.location }) }], { fields: [], references: [] });
  }

  const { frontmatter, body, sourceRange } = parsed.value;
  const diagnostics: Diagnostic[] = [];
  const { name, description } = frontmatter;

  if (typeof name !== "string" || !name.trim()) {
    diagnostics.push({ severity: "error", code: "structure.missing-name", message: "文档头的 name 必须是非空文本。", location: keyLocation(text, sourceRange.end, "name") });
  } else if (name.length > NAME_LIMIT || !NAME_PATTERN.test(name)) {
    diagnostics.push({ severity: "warning", code: "convention.name-format", message: `name 建议只用小写字母、数字和连字符，且不超过 ${NAME_LIMIT} 个字符。CLI 还会核对它与目录名一致。`, location: keyLocation(text, sourceRange.end, "name") });
  }

  if (typeof description !== "string" || !description.trim()) {
    diagnostics.push({ severity: "error", code: "structure.missing-description", message: "文档头的 description 必须是非空文本。", location: keyLocation(text, sourceRange.end, "description") });
  } else if (description.length > DESCRIPTION_LIMIT) {
    diagnostics.push({ severity: "warning", code: "convention.description-length", message: `description 有 ${description.length} 个字符，建议不超过 ${DESCRIPTION_LIMIT}，并说明何时使用这个 Skill。`, location: keyLocation(text, sourceRange.end, "description") });
  }

  const trimmed = body.trim();
  if (!trimmed) {
    diagnostics.push({ severity: "warning", code: "document.empty-body", message: "正文为空：文档头之后没有给 Agent 的操作说明。", location: locate(text, sourceRange.end) });
  }

  const references = new Set<string>();
  const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLink.exec(body)) !== null) {
    const raw = referencePath(match[1] ?? "");
    if (!raw || isExternalReference(raw)) continue;
    const start = sourceRange.end + match.index;
    const normalized = normalizeReference(raw);
    if (normalized === undefined) {
      diagnostics.push({ severity: "error", code: "structure.unsafe-path", message: `相对引用超出了 Skill 根目录：${raw}。请改用根目录内的相对路径。`, location: locate(text, start, start + match[0].length) });
    } else {
      references.add(normalized);
    }
  }
  if (references.size) {
    diagnostics.push({ severity: "info", code: "structure.reference", message: `引用了 ${references.size} 个本地资源。网页读不到目录，文件是否存在请用 CLI 核验。` });
  }

  const fields = Object.entries(frontmatter).map(([key, value]) => ({ key, value: describeValue(value), structured: typeof value !== "string" }));
  return finish(diagnostics, {
    fields,
    references: [...references],
    body: { characters: [...trimmed].length, lines: trimmed ? trimmed.split("\n").length : 0 },
  });
}

/**
 * A short Markdown summary for a pull request or issue comment. It lists findings only:
 * no field values or body text, apart from an offending reference path.
 */
export function summarize(inspection: Inspection): string {
  const label = { error: "未通过", warning: "可解析，有建议", valid: "通过" }[inspection.state];
  const mark: Record<Severity, string> = { error: "错误", warning: "建议", info: "提示" };
  const lines = [`**SKILL.md 文档检查：${label}**`, ""];
  if (!inspection.diagnostics.length) lines.push("- 文档头可解析，name 与 description 均已填写。");
  for (const item of inspection.diagnostics) {
    const at = item.location ? `（第 ${item.location.line} 行，第 ${item.location.column} 列）` : "";
    lines.push(`- ${mark[item.severity]} \`${item.code}\`${at}：${item.message}`);
  }
  lines.push("", "_仅检查文档格式。来源、权限与交付物需用 SkillSync CLI 在本机核验。_");
  return lines.join("\n");
}
