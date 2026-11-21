import { BYTE_LIMIT, byteLength, inspectDocument, summarize, type Diagnostic, type Inspection } from "./inspect";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = $<HTMLTextAreaElement>("#source");
const gutter = $("#gutter");
const panel = $("#result-panel");
const status = $("#status");
const message = $("#message");
const locate = $<HTMLButtonElement>("#locate");
const diagnosticList = $("#diagnostics");
const fields = $("#fields");
const references = $("#references");
const copySummary = $<HTMLButtonElement>("#copy-summary");
const fileInput = $<HTMLInputElement>("#file-input");
const editorPanel = $("#editor-panel");
const shortcuts = $<HTMLDialogElement>("#shortcuts");

const THEME_KEY = "skillsync.inspector.theme";
const example = "---\nname: inventory-check\ndescription: 对照清单核对库存。\n---\n\n先读取清单，再逐项核对应有与实收数量。";
const severityLabel = { error: "错误", warning: "建议", info: "提示" } as const;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

let inspection: Inspection | undefined;
let located: Diagnostic[] = [];
let cursor = -1;
let timer: number | undefined;
let lineCount = 0;

// Storage only remembers the appearance. Document text is never persisted.
function readTheme(): string | null { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function writeTheme(value: string) { try { localStorage.setItem(THEME_KEY, value); } catch { /* appearance stays for this visit */ } }

function updateMeta() {
  const lines = input.value ? input.value.split("\n").length : 0;
  $("#document-meta").textContent = `${lines} 行 · ${byteLength(input.value)} B`;
}

/** One number per line. The textarea does not wrap, so both scroll in step. */
function renderGutter() {
  const lines = Math.max(1, input.value.split("\n").length);
  if (lines !== lineCount) {
    lineCount = lines;
    gutter.replaceChildren(...Array.from({ length: lines }, (_, index) => {
      const row = document.createElement("div");
      row.textContent = String(index + 1);
      return row;
    }));
  }
  const marks = new Map<number, string>();
  for (const item of inspection?.diagnostics ?? []) {
    if (item.location && item.severity !== "info" && marks.get(item.location.line) !== "error") marks.set(item.location.line, item.severity);
  }
  Array.from(gutter.children).forEach((row, index) => {
    const mark = marks.get(index + 1);
    if (mark) (row as HTMLElement).dataset.mark = mark; else delete (row as HTMLElement).dataset.mark;
  });
  gutter.scrollTop = input.scrollTop;
}

function reveal(item: Diagnostic) {
  if (!item.location) return;
  input.focus();
  input.setSelectionRange(item.location.start, Math.max(item.location.end, item.location.start));
  const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 22;
  input.scrollTop = Math.max(0, (item.location.line - 1) * lineHeight - input.clientHeight / 2);
  if (item.location.column < 40) input.scrollLeft = 0;
  gutter.scrollTop = input.scrollTop;
}

function step(offset: number) {
  if (!located.length) return;
  cursor = (cursor + offset + located.length) % located.length;
  reveal(located[cursor]!);
}

function renderDiagnostics(items: Diagnostic[]) {
  diagnosticList.replaceChildren(...items.map(item => {
    const row = document.createElement("li");
    row.dataset.severity = item.severity;
    const body = document.createElement(item.location ? "button" : "div");
    if (body instanceof HTMLButtonElement) {
      body.type = "button";
      body.addEventListener("click", () => { cursor = located.indexOf(item); reveal(item); });
    }
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = severityLabel[item.severity];
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = item.message;
    const code = document.createElement("code");
    code.textContent = item.code + (item.location ? ` · 第 ${item.location.line} 行，第 ${item.location.column} 列` : "");
    body.append(tag, text, code);
    row.append(body);
    return row;
  }));
}

function renderFields(result: Inspection) {
  const rows: Array<[string, string, boolean]> = result.fields.map(field => [field.key, field.value, field.structured]);
  if (result.body) rows.push(["正文", `${result.body.characters} 个字符 · ${result.body.lines} 行`, true]);
  fields.replaceChildren(...rows.flatMap(([key, value, derived]) => {
    const term = document.createElement("dt"), detail = document.createElement("dd");
    term.textContent = key;
    detail.textContent = value;
    if (derived) detail.dataset.derived = "";
    return [term, detail];
  }));
  $("#fields-block").hidden = !rows.length;
  references.replaceChildren(...result.references.map(path => {
    const row = document.createElement("li");
    row.textContent = path;
    return row;
  }));
  $("#references-block").hidden = !result.references.length;
}

function renderIdle() {
  inspection = undefined; located = []; cursor = -1;
  panel.dataset.state = "idle";
  status.textContent = "等待文档";
  message.textContent = "粘贴或打开一份 SKILL.md 后，这里会列出问题、文档头字段和引用的本地资源。";
  locate.hidden = true; copySummary.hidden = true;
  diagnosticList.replaceChildren(); fields.replaceChildren(); references.replaceChildren();
  $("#fields-block").hidden = true; $("#references-block").hidden = true;
  renderGutter();
}

function check() {
  window.clearTimeout(timer);
  updateMeta();
  if (!input.value.trim()) { renderIdle(); return; }
  const result = inspectDocument(input.value);
  inspection = result;
  located = result.diagnostics.filter(item => item.location);
  cursor = -1;
  panel.dataset.state = result.state;
  const errors = result.diagnostics.filter(item => item.severity === "error").length;
  const warnings = result.diagnostics.filter(item => item.severity === "warning").length;
  if (result.state === "error") {
    status.textContent = `发现 ${errors} 个错误`;
    message.textContent = result.fields.length ? "修正后才能通过 CLI 的结构核验。" : "文档头无法读取，修正后才会显示字段。";
  } else if (result.state === "warning") {
    status.textContent = "文档可解析";
    message.textContent = `名称与描述均已填写，另有 ${warnings} 条建议。`;
  } else {
    status.textContent = "文档可解析";
    message.textContent = "名称与描述均已填写。";
  }
  locate.hidden = !result.diagnostics.some(item => item.severity === "error" && item.location);
  copySummary.hidden = false;
  renderDiagnostics(result.diagnostics);
  renderFields(result);
  renderGutter();
}

function schedule() {
  updateMeta();
  renderGutter();
  window.clearTimeout(timer);
  timer = window.setTimeout(check, 250);
}

function inspect() {
  check();
  $("#result-heading").focus();
}

function refuse(text: string) {
  inspection = undefined; located = []; cursor = -1;
  panel.dataset.state = "error";
  status.textContent = "文档过大";
  message.textContent = text;
  locate.hidden = true; copySummary.hidden = true;
  diagnosticList.replaceChildren();
}

const tooLarge = (value: string) => value.length > BYTE_LIMIT || byteLength(value) > BYTE_LIMIT;

function checkInsertion(event: Event, text: string | null) {
  if (!text) return;
  if (text.length > BYTE_LIMIT || tooLarge(input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd))) {
    event.preventDefault();
    window.clearTimeout(timer);
    refuse("本次输入超过 24 KiB，原文已保留。");
  }
}

/** Replaces the editor text after protecting anything the user typed. */
function replaceDocument(text: string, question: string) {
  if (input.value.trim() && input.value !== example && input.value !== text && !window.confirm(question)) return false;
  input.value = text;
  input.scrollTop = 0; input.scrollLeft = 0;
  check();
  return true;
}

async function openFile(file: File) {
  if (file.size > BYTE_LIMIT) { refuse(`「${file.name}」超过 24 KiB，原文已保留。`); return; }
  const raw = await file.text();
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (text.includes("\0")) { refuse(`「${file.name}」不是文本文件，原文已保留。`); return; }
  if (replaceDocument(text, `用「${file.name}」替换当前文档？`)) input.focus();
}

async function writeClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
  const area = document.createElement("textarea");
  area.value = text; area.className = "clipboard-buffer"; area.readOnly = true;
  document.body.append(area); area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("clipboard unavailable");
}

function effectiveTheme() {
  const stored = readTheme();
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function paintTheme(theme: string, explicit: boolean) {
  if (explicit) document.documentElement.dataset.theme = theme;
  $("#theme-toggle").setAttribute("aria-label", theme === "dark" ? "切换到浅色外观" : "切换到深色外观");
}

// ---- wiring ---------------------------------------------------------------

input.addEventListener("input", schedule);
input.addEventListener("scroll", () => { gutter.scrollTop = input.scrollTop; });
input.addEventListener("paste", event => checkInsertion(event, event.clipboardData?.getData("text/plain") ?? null));
input.addEventListener("beforeinput", event => {
  if (event.cancelable && event.inputType.startsWith("insert")) checkInsertion(event, event.data);
});

$("#check").addEventListener("click", inspect);
locate.addEventListener("click", () => {
  const first = located.find(item => item.severity === "error");
  if (first) { cursor = located.indexOf(first); reveal(first); }
});
$("#example").addEventListener("click", () => { if (replaceDocument(example, "用示例替换当前文档？")) input.focus(); });
$("#clear").addEventListener("click", () => { if (replaceDocument("", "清空当前文档？")) input.focus(); });
$("#open-file").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void openFile(file);
});

copySummary.addEventListener("click", () => {
  if (!inspection) return;
  const label = copySummary.querySelector("span")!;
  writeClipboard(summarize(inspection)).then(
    () => { label.textContent = "已复制"; },
    () => { label.textContent = "无法写入剪贴板"; },
  ).finally(() => window.setTimeout(() => { label.textContent = "复制摘要"; }, 1600));
});

// Dropping a file anywhere on the editor panel loads it; other drags are left alone.
const carriesFile = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
editorPanel.addEventListener("dragover", event => {
  if (!carriesFile(event)) return;
  event.preventDefault();
  editorPanel.dataset.dragging = "";
});
editorPanel.addEventListener("dragleave", event => {
  if (!editorPanel.contains(event.relatedTarget as Node | null)) delete editorPanel.dataset.dragging;
});
editorPanel.addEventListener("drop", event => {
  if (!carriesFile(event)) return;
  event.preventDefault();
  delete editorPanel.dataset.dragging;
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

$("#guide-example").addEventListener("click", () => $<HTMLButtonElement>("#example").click());
$("#guide-check").addEventListener("click", inspect);

shortcuts.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => shortcuts.close()));
shortcuts.addEventListener("click", event => { if (event.target === shortcuts) shortcuts.close(); });
$("#open-shortcuts").addEventListener("click", () => { if (!shortcuts.open) shortcuts.showModal(); });
document.querySelectorAll("kbd[data-mod]").forEach(key => { key.textContent = isMac ? "⌘" : "Ctrl"; });

$("#theme-toggle").addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  writeTheme(next);
  paintTheme(next, true);
});

document.addEventListener("keydown", event => {
  if (shortcuts.open) return;
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (mod && !event.altKey && !event.shiftKey) {
    if (event.key === "Enter") { event.preventDefault(); inspect(); }
    else if (event.key.toLowerCase() === "o") { event.preventDefault(); fileInput.click(); }
    return;
  }
  if (event.key === "F8") { event.preventDefault(); step(event.shiftKey ? -1 : 1); return; }
  const typing = event.target instanceof HTMLElement && event.target.matches("input, textarea, select");
  if (event.key === "?" && !typing && !mod && !event.altKey) { event.preventDefault(); shortcuts.showModal(); }
});

const storedTheme = readTheme();
paintTheme(effectiveTheme(), storedTheme === "light" || storedTheme === "dark");
input.value = example;
check();
