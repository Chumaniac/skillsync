import { parseSkillDocument } from "../src/domain/frontmatter";
const input = document.querySelector<HTMLTextAreaElement>("#source")!;
const status = document.querySelector<HTMLElement>("#status")!;
const message = document.querySelector<HTMLElement>("#message")!;
const locate = document.querySelector<HTMLButtonElement>("#locate")!;
let errorLocation: {start: number; end: number; line: number; column: number} | undefined;
function setState(value: string) { document.querySelector<HTMLElement>(".result-panel")!.dataset.state = value; }
function updateMeta() { document.querySelector("#document-meta")!.textContent = input.value.split("\n").length + " 行 · " + new TextEncoder().encode(input.value).length + " B"; }
function resetLocation() {
  errorLocation = undefined;
  locate.hidden = true;
}
locate.addEventListener("click", () => {
  if (!errorLocation) return;
  input.focus();
  input.setSelectionRange(errorLocation.start, errorLocation.end);
  // WebKit can move the selection without scrolling a wrapped textarea.
  const measure = input.cloneNode(false) as HTMLTextAreaElement;
  measure.removeAttribute("id");
  measure.className = "diagnostic-measure";
  measure.setAttribute("aria-hidden", "true");
  measure.tabIndex = -1;
  measure.style.width = input.clientWidth + "px";
  measure.value = input.value.slice(0, errorLocation.start) + "\u200b";
  input.after(measure);
  input.scrollTop = Math.max(0, measure.scrollHeight - input.clientHeight / 2);
  measure.remove();
});
const fields = document.querySelector<HTMLElement>("#fields")!;
const example = "---\nname: inventory-check\ndescription: 对照清单核对库存。\n---\n\n先读取清单，再逐项核对应有与实收数量。";
const byteLimit = 24 * 1024;
const encoder = new TextEncoder();
function tooLarge(value: string) {
  return value.length > byteLimit || encoder.encode(value).length > byteLimit;
}
function oversized() {
  setState("error");
  resetLocation();
  fields.replaceChildren();
  status.textContent = "文档过大";
  message.textContent = "最多可检查 24 KiB。请缩短文档后重试。";
}
function checkInsertion(event: Event, text: string | null) {
  if (!text) return;
  if (text.length > byteLimit || tooLarge(input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd))) {
    event.preventDefault();
    oversized();
    message.textContent = "本次输入超过 24 KiB，原文已保留。";
  }
}
input.addEventListener("paste", event => checkInsertion(event, event.clipboardData?.getData("text/plain") ?? null));
input.addEventListener("beforeinput", event => {
  if (event.cancelable && event.inputType.startsWith("insert")) checkInsertion(event, event.data);
});
function clear() {
  setState("idle"); updateMeta();
  resetLocation();
  status.textContent = "等待检查";
  message.textContent = "文档已更新，请重新检查。";
  fields.replaceChildren();
}
function check() {
  resetLocation();
  fields.replaceChildren();
  if (tooLarge(input.value)) {
    oversized(); return;
  }
  const parsed = parseSkillDocument(input.value);
  if (!parsed.ok) {
    setState("error");
    status.textContent = "无法解析文档";
    errorLocation = parsed.location;
    if (errorLocation) {
      message.textContent = "第 " + errorLocation.line + " 行，第 " + errorLocation.column + " 列。" + parsed.error;
      locate.hidden = false;
    } else {
      message.textContent = parsed.error;
    }
    return;
  }
  setState("valid");
  status.textContent = "文档可解析";
  const {frontmatter, body} = parsed.value;
  const missing = ["name","description"].filter(key => typeof frontmatter[key] !== "string" || !frontmatter[key].trim());
  message.textContent = missing.length ? "请补充文本字段 " + missing.join("、") : "名称与描述均已填写。";
  const values = Object.entries(frontmatter).map(([key,value]) => [key, typeof value === "string" ? value : "（结构化字段）"]);
  values.push(["正文", [...body.trim()].length + " 个字符"]);
  for (const [key,value] of values) {
    const term = document.createElement("dt"), detail = document.createElement("dd");
    term.textContent = key; detail.textContent = value; fields.append(term,detail);
  }
}
input.value = example;
updateMeta();
input.addEventListener("input",clear);
function inspect() { check(); document.getElementById("result-heading")!.focus(); }
document.querySelector("#check")!.addEventListener("click", inspect);
input.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); inspect(); } });
document.querySelector("#example")!.addEventListener("click", () => {
  if (input.value.trim() && input.value !== example && !window.confirm("用示例替换当前文档？")) return;
  input.value = example;
  clear();
  input.focus();
});

document.querySelector('#guide-example')!.addEventListener('click', () => document.querySelector<HTMLButtonElement>('#example')!.click());
document.querySelector('#guide-check')!.addEventListener('click', inspect);
