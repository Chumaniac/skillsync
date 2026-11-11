import { reportLabel } from "./report-labels.js";
import {type BatchReport,canonicalJson,validateBatchReport} from "../domain/batch-report.js";
import {artifactsReviewStyle,renderArtifactsFragment} from "./artifacts-html.js";

const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const HTML_LIMIT=7*1024*1024;
/** Offline display is bounded independently of the complete JSON evidence. */
export function renderBatchHtml(input:BatchReport,expectedDeclarations?:string):string {
 const report=validateBatchReport(input,expectedDeclarations);let used=0;
 const rows=report.batches.map(item=>`<tr><td><a href="#batch-${escape(item.id)}">${escape(item.id)}</a></td><td>${escape(reportLabel(item.status))}</td><td>${item.mode==='reused'?'复用未变化的已通过证据':'检查当前输入'}</td><td>${item.report.findings.length}</td></tr>`).join('');
 const sections=report.batches.map(item=>{
  let detail='<p>完整有界证据保留在JSON复核包中，此报告超出离线明细展示容量。</p>';
  if(Buffer.byteLength(canonicalJson(item.report))<=256*1024){
   const rendered=renderArtifactsFragment(item.report, 'batch-'+item.id+'-'),size=Buffer.byteLength(rendered);
   if(size<=512*1024&&used+size<5*1024*1024){used+=size;detail=`<details><summary>查看声明检查与受影响记录</summary><div class="artifact-review">${rendered}</div></details>`;}
  }
  const comparison=item.comparison?.status==='compared'?`<p>与保留的此前报告相比：${item.comparison.findings!.added} 类新增、${item.comparison.findings!.ongoing} 类持续、${item.comparison.findings!.resolved} 类已解决问题。</p>`:item.comparison?`<p>暂时无法对比： ${escape(item.comparison.reason)}. 不会根据不完整证据推断改善。</p>`:'';
  return `<section id="batch-${escape(item.id)}"><h2>${escape(item.id)} · ${escape(reportLabel(item.status))}</h2><p>${item.mode==='reused'?'已记录复用未变化且通过检查的输入。':'已记录对所选输入的检查。'} ${item.source_files} 个文件 · ${item.source_bytes} 字节。</p>${comparison}<details><summary>证据绑定</summary><p>输入快照： <code>${escape(item.source_sha256??'暂不可用')}</code></p><p>报告： <code>${item.report_sha256}</code></p></details>${detail}</section>`;
 }).join('');
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src about: 'self'; base-uri 'none'; form-action 'none'"><title>SkillSync 批次验收</title><style>${artifactsReviewStyle}
:root{--bg:#f1f5fa;--surface:#fff;--text:#17283e;--muted:#50667d;--line:#cbd8e6;--accent:#2055a0}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:28px 20px}h1{font-size:28px}h2{font-size:20px}section,.summary{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px;margin:20px 0}p{overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}a{color:var(--accent)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.artifact-review>section{border:0;border-top:1px solid var(--line);border-radius:0;padding-inline:0}.artifact-review .hero{margin-top:16px}.artifact-review h2{scroll-margin-top:16px}summary{cursor:pointer}small{color:var(--muted)}@media(max-width:600px){main{padding:16px 10px}section,.summary{padding:14px}th,td{padding:8px;font-size:12px}}</style><main><h1>批次验收</h1><div class="summary"><p><strong>${escape(reportLabel(report.status))}</strong> · ${report.counts.passed} 通过 · ${report.counts.failed} 失败 · ${report.counts.incomplete} 未完成。</p><p>复核包完整性已验证。打开此页面不会重新检查原始数据，也不认证作者；结果只描述已记录约定与输入快照。</p><p>${escape(report.createdAt)} · SkillSync ${escape(report.tool_version)} · 只读核验 · 未执行技能包。</p><p>计划： <code>${report.declaration.plan_sha256}</code></p><p>约定： <code>${report.declaration.contract_sha256}</code></p></div><table aria-label="批次验收结果"><thead><tr><th>批次</th><th>结果</th><th>证据来源</th><th>问题数</th></tr></thead><tbody>${rows}</tbody></table>${sections}<p><small>不展示原始数据行、原始绝对路径及数值预期。自定义批次ID、相对文件名、列与检查声明、记录位置仍可能敏感。哈希仅建立完整性绑定，不代表可信作者或科研与生产验收。明细展示设有独立容量上限。</small></p></main></html>`;
 if(Buffer.byteLength(html)>HTML_LIMIT)throw new Error('离线批次报告超出展示容量。');
 return html;
}
