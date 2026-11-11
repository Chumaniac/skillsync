import { parseSkillDocument } from "../src/domain/frontmatter";
const input = document.querySelector<HTMLTextAreaElement>("#source")!;
const status = document.querySelector<HTMLElement>("#status")!;
const message = document.querySelector<HTMLElement>("#message")!;
const fields = document.querySelector<HTMLElement>("#fields")!;
const example = "---\nname: inventory-check\ndescription: 对照清单核对库存。\n---\n\n先读取清单，再逐项核对应有与实收数量。";
function clear() {
  status.textContent = "等待检查";
  message.textContent = "文档已更新，请重新检查。";
  fields.replaceChildren();
}
function check() {
  fields.replaceChildren();
  if (new TextEncoder().encode(input.value).length > 24576) {
    status.textContent = "文档过大"; message.textContent = "请缩短至 24 KiB 后重试。"; return;
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
