/** Static local UI. All evidence is inserted as text or in a scriptless report frame. */
export function workbenchPage(nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="client" content="${nonce}"><title>SkillSync 核验台</title><link rel="stylesheet" href="/style.css"></head><body><main>
<header><span>SkillSync · 本机</span><h1>核验台</h1></header>
<section aria-labelledby="selection"><h2 id="selection">1. 选择目录</h2><label for="root">Skill 或交付目录</label><div class="row"><input id="root" placeholder="/Users/you/skills/review…" autocomplete="off"><button id="choose" type="button">选择目录…</button></div><label for="kind">核验内容</label><select id="kind"><option value="skill">Skill 结构与兼容性</option><option value="artifacts">交付文件与验收清单</option></select><div id="contract-fields" hidden><label for="contract">验收清单路径（YAML / JSON）</label><div class="row"><input id="contract" autocomplete="off"><button id="choose-contract" type="button">选择清单…</button></div><label><input id="delivery" type="checkbox">这是 SkillTape 交付包（包含 delivery.json）</label></div><div class="row actions"><button id="verify" type="button">核验目录</button><button id="cancel" type="button" disabled>取消核验</button></div></section>
<p id="status" role="status" aria-live="polite">尚未核验</p><section id="result" hidden aria-labelledby="result-title"><h2 id="result-title">2. 核验结果</h2><iframe id="report" title="核验报告" sandbox=""></iframe><button id="plan" type="button">生成修复计划</button></section>
<section id="fix" hidden aria-labelledby="fix-title"><h2 id="fix-title">3. 审阅修复计划</h2><pre id="changes"></pre><label><input id="confirm" type="checkbox">我已审阅，应用以上安全修复并保留备份</label><div class="row actions"><button id="apply" type="button" disabled>应用并备份</button><button id="reverify" type="button">重新核验</button></div><p id="receipt"></p></section><footer><p>仅在本机核验，不执行 Skill。</p><details><summary>报告保存位置</summary><p>报告、修复计划和回执保存在本机私有状态目录。</p></details></footer></main><script src="/app.js"></script></body></html>`;
}

export const workbenchStyle = `:root{font:16px/1.6 system-ui;color:#19343c;background:#f3f6f6}*{box-sizing:border-box}main{max-width:1040px;margin:auto;padding:32px 20px}header{margin-bottom:28px}h1{margin:8px 0;font-size:36px}h2{font-size:20px}section{padding:20px;background:white;border:1px solid #c8d8dc;border-radius:8px;margin:20px 0}label{display:block;margin:12px 0 6px}input:not([type=checkbox]),select{font:inherit;min-height:44px;padding:8px;width:100%;border:1px solid #829fa7;border-radius:4px}input[type=checkbox]{width:24px;height:24px;vertical-align:middle;margin-right:8px}label:has(input[type=checkbox]){min-height:44px;display:flex;align-items:center}button{font:inherit;min-height:44px;padding:8px 18px;border:1px solid #6f939d;border-radius:4px;color:#19343c;background:#edf5f6;cursor:pointer}button:disabled{opacity:.55;cursor:default}.row{display:flex;gap:12px;align-items:center}.row input{flex:1;min-width:0}.row button{white-space:nowrap}.actions{flex-wrap:wrap;margin-top:18px}:focus-visible{outline:3px solid #087a91;outline-offset:3px}iframe{width:100%;height:580px;border:1px solid #c8d8dc;margin-bottom:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace}footer{font-size:13px;color:#496771}footer p{margin:8px 0}summary{cursor:pointer;min-height:44px;padding:8px 0}#status{padding:12px;border-left:3px solid #318496}[hidden]{display:none!important}@media(max-width:580px){.row{flex-wrap:wrap}.row input{flex-basis:100%}main{padding:16px}section{padding:16px}}`;

export const workbenchScript = `"use strict";
const $ = id => document.getElementById(id);
const nonce = document.querySelector('meta[name="client"]').content;
let busy = false, planId = null, selected = null;
async function api(action, body = {}) {
 const response = await fetch('/api/' + action, {method:'POST',headers:{'Content-Type':'application/json','X-SkillSync-Client':nonce},body:JSON.stringify(body)});
 const data = await response.json(); if(!response.ok) throw new Error(data.error || '请求未完成'); return data;
}
function status(text){ $('status').textContent = text; }
function lock(value, applying = false){ busy=value; ['verify','plan','reverify','choose','choose-contract','root','contract','kind','delivery'].forEach(id => $(id).disabled=value); $('cancel').disabled=!value || applying; $('apply').disabled=value || !$('confirm').checked || !planId; }
function invalidate(){ selected=null; planId=null; $('result').hidden=true; $('fix').hidden=true; $('confirm').checked=false; $('report').srcdoc=''; status('目录或模式已更改，请重新核验'); }
['root','contract','kind','delivery'].forEach(id => $(id).addEventListener('change', () => {invalidate(); $('contract-fields').hidden=$('kind').value!=='artifacts';}));
for(const [button,field] of [['choose','root'],['choose-contract','contract']]) $(button).onclick=async()=>{ lock(true,true); try { const data=await api('choose',{file:field==='contract'}); $(field).value=data.path; invalidate(); } catch(e){status(e.message);} finally{lock(false);} };
async function verify(recheck=false){ lock(true); status(recheck?'正在重新核验…':'正在核验…'); try {
 if(!recheck){ await api('select',{path:$('root').value,kind:$('kind').value,contract:$('contract').value,delivery:$('delivery').checked}); planId=null; $('fix').hidden=true; $('confirm').checked=false; }
 const data=await api('verify'); selected=true; $('report').srcdoc=data.html; $('result').hidden=false; $('plan').hidden=$('kind').value!=='skill'; status((recheck?'重新核验完成':'核验完成')+' · '+data.status); if(recheck) $('receipt').textContent='最新核验：'+data.status;
 }catch(e){status(e.message);}finally{lock(false);} }
$('verify').onclick=()=>verify(); $('reverify').onclick=()=>verify(true);
$('cancel').onclick=async()=>{try{await api('cancel');status('已请求取消，等待核验器退出…');}catch(e){status(e.message);}};
$('plan').onclick=async()=>{if(!selected)return;lock(true);try{const data=await api('plan');planId=data.id; $('changes').textContent=data.description; $('fix').hidden=false; $('confirm').checked=false; $('receipt').textContent='仅生成计划，尚未应用。'; status('计划已生成，请审阅');}catch(e){status(e.message);}finally{lock(false);}};
$('confirm').onchange=()=>{$('apply').disabled=busy||!$('confirm').checked||!planId;};
$('apply').onclick=async()=>{lock(true,true);try{const data=await api('apply',{id:planId,confirm:$('confirm').checked}); planId=null; $('confirm').checked=false; $('receipt').textContent=data.message; status('已备份并应用，请重新核验');}catch(e){planId=null;$('confirm').checked=false;status(e.message+'；请重新核验当前目录');}finally{lock(false);}};
`;
