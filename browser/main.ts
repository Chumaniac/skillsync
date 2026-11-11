import { parseSkillDocument } from "../src/domain/frontmatter";
const input = document.querySelector<HTMLTextAreaElement>("#source")!;
const status = document.querySelector<HTMLElement>("#status")!;
const message = document.querySelector<HTMLElement>("#message")!;
const fields = document.querySelector<HTMLElement>("#fields")!;
const example = "---\nname: inventory-check\ndescription: 对照清单核对库存。\n---\n\n先读取清单，再逐项核对应有与实收数量。";
const byteLimit = 24 * 1024;
const encoder = new TextEncoder();
function tooLarge(value: string) {
  return value.length > byteLimit || encoder.encode(value).length > byteLimit;
}
function oversized() {
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
  status.textContent = "等待检查";
  message.textContent = "文档已更新，请重新检查。";
  fields.replaceChildren();
}
function check() {
  fields.replaceChildren();
  if (tooLarge(input.value)) {
    oversized(); return;
  }
  const parsed = parseSkillDocument(input.value);
  if (!parsed.ok) {
    status.textContent = "无法解析文档"; message.textContent = parsed.error; return;
  }
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
input.addEventListener("input",clear);
document.querySelector("#check")!.addEventListener("click",check);
document.querySelector("#example")!.addEventListener("click",()=>{input.value=example;clear();input.focus()});
