/** Static local UI. All evidence is inserted as text or in a scriptless report frame. */
export function workbenchPage(nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="client" content="${nonce}"><title>SkillSync 核验台</title><link rel="stylesheet" href="/style.css"></head><body><a class="skip-link" href="#workspace">跳到当前操作</a><main id="workspace" tabindex="-1">
<header><p class="product-name">SkillSync</p><h1>本机核验台</h1><p>打开 Skill 目录或交付包，查看核验结果、历史记录与修复计划。</p></header>
<nav class="task-nav" aria-label="核验任务"><button id="nav-single" type="button" aria-controls="task-single" aria-pressed="true">单目录核验</button><button id="nav-batch" type="button" aria-controls="task-batch" aria-pressed="false">多批次验收</button><button id="nav-history" type="button" aria-controls="task-history" aria-pressed="false">历史记录</button></nav>
<section id="task-batch" hidden aria-labelledby="batch-title"><h2 id="batch-title" tabindex="-1">验收多个交付</h2><p class="task-steps">预检计划 → 逐批核验 → 保存复核包</p><p>按计划只读核验多个交付；修正失败批次后保留已通过的证据。打开复核包只检查完整性，不重新核验原始数据或认证作者。</p><label for="batch-plan">验收计划文件</label><div class="row"><input id="batch-plan" autocomplete="off" placeholder="/project/acceptance-plan.json"><button id="choose-batch-plan" type="button">选择计划…</button></div><button id="batch-preview" type="button">预检验收计划</button><p id="batch-info" role="status"></p><label for="batch-output">新复核包文件</label><input id="batch-output" autocomplete="off"><label for="batch-previous">上次复核包（可选）</label><input id="batch-previous" autocomplete="off"><label><input id="batch-retry" type="checkbox">只重验失败或不完整批次，已通过输入必须保持不变</label><div class="row actions"><button class="primary" id="batch-run" type="button" disabled>执行并生成复核包</button></div><div id="batch-recovery" class="mode-help" hidden><h3>先核对此次输出</h3><p id="batch-recovery-state" role="status"></p><button id="batch-recover" type="button">检查此次输出包</button></div><hr><h3>查阅已保存的复核包</h3><p>此操作只读取已有证据，不重新核验原始文件。</p><label for="batch-package">复核包路径</label><div class="row"><input id="batch-package" autocomplete="off"><button id="choose-batch-package" type="button">选择复核包…</button></div><label for="batch-digest">预期 SHA-256（可选，来自独立可信来源，不会自动填入包自身摘要）</label><input id="batch-digest" autocomplete="off" maxlength="64"><label for="batch-contract">原契约路径（旧复核包必填，新包可选）</label><div class="row"><input id="batch-contract" autocomplete="off"><button id="choose-batch-contract" type="button">选择原契约…</button></div><button id="batch-open" type="button">打开并复核完整性</button><p id="batch-receipt" role="status"></p></section>
<section id="task-history" hidden aria-labelledby="history-title"><h2 id="history-title" tabindex="-1">查看已存证据</h2><div class="history-filters"><label for="history-query">目录名包含</label><input id="history-query" maxlength="128" autocomplete="off" placeholder="只查目录名"><label for="history-kind">任务类型</label><select id="history-kind"><option value="">全部任务</option><option value="verify">核验</option><option value="plan">修复计划</option><option value="apply-intent">应用请求</option><option value="apply">应用回执</option></select><label for="history-exit">已记录的退出码</label><select id="history-exit"><option value="">全部结果</option><option value="0">0 · 正常完成</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select><div class="row actions"><button id="history-filter" type="button">筛选记录</button><button id="history-clear" type="button">清除筛选</button></div></div><p id="history-info" role="status"></p><div id="history-list"></div><div class="row actions"><button id="history-prev" type="button" disabled>上一页</button><button id="history-next" type="button" disabled>下一页</button><button id="history-refresh" type="button">刷新</button></div><p>选择历史记录作为基线，再核验当前文件。历史记录只读，打开不会重新执行核验或授予修复权限。</p><div class="history-comparison" role="region" aria-labelledby="history-compare-title"><h3 id="history-compare-title">比较两份已存核验</h3><p>在记录旁选择较早、较晚的核验，或输入两份记录编号。不会重新运行核验，也不改变当前修复计划。</p><label for="history-compare-before">较早记录编号</label><input id="history-compare-before" maxlength="36" autocomplete="off" spellcheck="false"><label for="history-compare-after">较晚记录编号</label><input id="history-compare-after" maxlength="36" autocomplete="off" spellcheck="false"><div class="row actions"><button id="history-compare" type="button">比较已存记录</button><button id="history-compare-cancel" type="button" hidden>取消历史对照</button></div><p id="history-compare-info" role="status"></p><div id="history-compare-result" hidden></div><p>仅对照保存的证据；较晚记录未出现某项，不代表当前目录已经修复。报告未完整记录工具与策略条件，不能据此授予执行或修复权限。</p></div></section>
<section id="task-single" aria-labelledby="selection"><h2 id="selection" tabindex="-1">核验一个目录</h2><p class="task-steps">选择目录与范围 → 核验 → 查看结果</p><label for="root" id="root-label">Skill 根目录或包含 Skills 的目录</label><div class="row"><input id="root" name="root" aria-describedby="mode-help root-error" placeholder="/path/to/skill…" autocomplete="off"><button id="choose" type="button">选择目录…</button><button id="load-example" type="button">填入示例目录</button></div><p id="root-error" class="field-error" role="alert"></p><fieldset class="selection-options"><legend>选择要完成的任务</legend><label><input id="mode-skill" name="verification-kind" type="radio" value="skill" checked><span><strong>检查一个 Skill</strong><small>检查结构、兼容性与声明；可继续审阅处理计划</small></span></label><label><input id="mode-artifacts" name="verification-kind" type="radio" value="artifacts"><span><strong>验收交付文件</strong><small>对照清单核对文件与数据，保留只读证据</small></span></label></fieldset><input id="kind" type="hidden" value="skill"><p id="mode-help" class="mode-help"></p><div id="contract-fields" hidden><label for="contract">验收清单路径（YAML / JSON）</label><div class="row"><input id="contract" name="contract" aria-describedby="contract-error" autocomplete="off"><button id="choose-contract" type="button">选择清单…</button></div><p id="contract-error" class="field-error" role="alert"></p><label><input id="delivery" type="checkbox">按 SkillTape 交付清单核验（delivery.json）</label></div><div class="row actions"><button class="primary" id="verify" type="button">核验目录</button></div></section>
<section class="operation-reconnect" aria-labelledby="operation-title"><h2 id="operation-title">后台操作</h2><p id="operation-state" role="status" aria-live="polite">正在核对后台状态…</p><button id="operation-check" type="button">检查后台状态</button></section><div class="operation-status"><p id="status" role="status" aria-live="polite">尚未核验</p><button id="cancel" type="button" disabled>取消当前核验</button></div><section id="result" hidden aria-labelledby="result-title"><h2 id="result-title" tabindex="-1">核验结果与证据</h2><div id="task-summary" class="result-summary" aria-labelledby="summary-title"><h3 id="summary-title"></h3><p id="summary-next" role="status"></p><ul id="summary-counts"></ul><div class="row actions"><button id="plan" type="button" hidden>生成处理计划</button><button id="result-recheck" type="button">重新核验当前文件</button><button id="result-details" type="button">查看报告明细</button></div></div><p id="comparison" role="status"></p><button id="export-summary" type="button" disabled>导出摘要</button><button id="export-json" type="button" disabled>导出核验 JSON</button><details id="structured-details"><summary>查看结构化证据</summary><pre id="structured-report">打开一份已保存的核验记录后查看。</pre></details><iframe id="report" title="核验报告" sandbox=""></iframe></section>
<section id="fix" hidden aria-labelledby="fix-title"><h2 id="fix-title" tabindex="-1">审阅修复计划</h2><pre id="changes"></pre><label><input id="confirm" type="checkbox">我已审阅，应用以上安全修复并保留备份</label><div class="row actions"><button id="apply" type="button" disabled>应用并备份</button><button id="reverify" type="button">重新核验</button></div><p id="receipt"></p></section><footer><p>只检查本机文件，不运行 Skill。</p><details><summary>报告保存位置</summary><p>报告、计划和回执保存在本机私有目录；历史功能启用前的文件仍保留。</p></details></footer></main><script src="/app.js"></script></body></html>`;
}

export const workbenchStyle = `:root{font:16px/1.6 system-ui;color:#19343c;background:#f3f6f6}*{box-sizing:border-box}main{max-width:1040px;margin:auto;padding:32px 20px}header{margin-bottom:28px}h1{margin:8px 0;font-size:28px;line-height:1.2}h3{font-size:17px}.product-name{font-weight:750;letter-spacing:-.02em;margin:0}.task-nav{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:16px;border-bottom:1px solid #c8d8dc}.task-nav button[aria-pressed=true]{color:white;background:#235661;border-color:#235661}.primary{color:white;background:#235661;border-color:#235661}.task-steps{color:#496771;font-size:14px}.skip-link{position:absolute;top:-100px;padding:12px;background:white;color:#19343c}.skip-link:focus{top:8px;z-index:10}h2[tabindex],main{scroll-margin-top:16px}h2[tabindex]:focus{outline:3px solid #087a91;outline-offset:5px}hr{border:0;border-top:1px solid #c8d8dc;margin:28px 0}h2{font-size:20px}section{padding:20px;background:white;border:1px solid #c8d8dc;border-radius:8px;margin:20px 0}label{display:block;margin:12px 0 6px}input:not([type=checkbox]),select{font:inherit;min-height:44px;padding:8px;width:100%;border:1px solid #829fa7;border-radius:4px}input[type=checkbox]{width:24px;height:24px;vertical-align:middle;margin-right:8px}label:has(input[type=checkbox]){min-height:44px;display:flex;align-items:center}button{font:inherit;min-height:44px;padding:8px 18px;border:1px solid #6f939d;border-radius:4px;color:#19343c;background:#edf5f6;cursor:pointer}button:disabled{opacity:.55;cursor:default}.row{display:flex;gap:12px;align-items:center}.row input{flex:1;min-width:0}.row button{white-space:nowrap}.actions{flex-wrap:wrap;margin-top:18px}:focus-visible{outline:3px solid #087a91;outline-offset:3px}iframe{width:100%;height:580px;border:1px solid #c8d8dc;margin-bottom:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace}#history-list p,#batch-receipt,#batch-info{overflow-wrap:anywhere}footer{font-size:13px;color:#496771}footer p{margin:8px 0}summary{cursor:pointer;min-height:44px;padding:8px 0}.operation-status{display:flex;align-items:center;justify-content:space-between;gap:12px}.operation-status button{flex-shrink:0}.operation-status p{overflow-wrap:anywhere}#status{padding:12px;border-left:3px solid #318496}[hidden]{display:none!important}.selection-options{border:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:12px}.selection-options label{display:flex;align-items:flex-start;gap:10px;border:1px solid #c8d8dc;border-radius:6px;padding:14px;margin:0}.selection-options label:has(input:checked){border-color:#235661;background:#edf5f6}.selection-options input[type=radio]{width:22px;min-height:22px;flex:0 0 22px}.selection-options small{display:block;color:#496771}.field-error{color:#9c2f35}.mode-help{background:#edf5f6;padding:12px}.result-summary{border-left:3px solid #318496;padding:4px 16px;margin:16px 0}.result-summary ul{display:flex;gap:18px;flex-wrap:wrap;padding-left:20px}.result-summary .actions{margin-bottom:16px}@media(max-width:580px){.selection-options{grid-template-columns:1fr}}@media(max-width:580px){.operation-status{align-items:flex-start;flex-direction:column}.row{flex-wrap:wrap}.row input{flex-basis:100%}main{padding:16px}section{padding:16px}}.history-comparison{margin-top:24px;padding-top:20px;border-top:1px solid #c8d8dc}.history-comparison-counts{display:flex;gap:20px;flex-wrap:wrap}.history-comparison-counts div{min-width:100px}.history-comparison-counts dt{font-size:14px}.history-comparison-counts dd{font-size:24px;margin:4px 0}.history-comparison code{overflow-wrap:anywhere}#history-list button{margin:4px}.history-comparison ul{padding-left:20px}:root{color:#242424;background:#f7f7f5}header,section,.result-summary{box-shadow:none;border-radius:8px}button,input,select{min-height:44px}button.primary,.task-nav button[aria-pressed=true]{background:#31594d;border-color:#31594d;color:#fff}button,input,select,section{border-color:#dedfd9}button{background:#fff;color:#242424}.mode-help,.selection-options label,.task-nav button:not([aria-pressed=true]){background:#f2f3ef;color:#242424}.task-steps,small,footer{color:#62655f}iframe{height:min(70vh,580px)}#structured-report{max-height:400px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}button,input,select{transition:background-color .2s,border-color .2s}@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;

export const workbenchScript = `"use strict";
const $ = id => document.getElementById(id);
const nonce = document.querySelector('meta[name="client"]').content;
let busy = false, planId = null, selected = null, baselineId = null, historyId = null, historyOffset = 0, historyTotal = 0, historyLoading = false, historyRefreshQueued = false, renderedHistory = null, batchReady=false, summaryCanPlan=false, recoveryPath=null;
let localBusy=false,localApplying=false,checkingOperation=true,observedOperation=null,ownedOperationId=null,ownedOperationKind=null,operationTimer=null,operationController=null,operationReads=0,operationDisposed=false;
const trackedActions=new Set(['select','choose','verify','plan','apply','batch/preview','batch/run','batch/open','history/open','history/export']);
const operationLabels={select:'选择目录',choose:'选择文件',verify:'核验',plan:'准备处理计划',apply:'应用已确认修复',batch_preview:'预检多批次计划',batch_run:'逐批核验',batch_open:'只读复核包',history_open:'读取历史',history_export:'导出历史摘要'};
const operationUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
// Switching tasks hides existing controls; it never replaces form nodes or submits them.
let historyFilters={query:''};
let historyCompareController=null,historyCompareSerial=0,historyCompareLoading=false;
let activeTask='single', resultOwner='single', resultAvailable=false, fixAvailable=false;
function syncWorkspace(){
 for(const task of ['single','batch','history']){ $('task-'+task).hidden=task!==activeTask; $('nav-'+task).setAttribute('aria-pressed',String(task===activeTask)); }
 $('result').hidden=!resultAvailable||resultOwner!==activeTask;
 $('fix').hidden=!fixAvailable||activeTask!=='single';
}
function setTask(task){if(activeTask==='history'&&task!=='history')clearHistoryComparison();activeTask=task;syncWorkspace();if(!$('result').hidden&&reportHtml)mountReport();$(task==='single'?'selection':task==='batch'?'batch-title':'history-title').focus();}
function revealResult(owner){resultOwner=owner;resultAvailable=true;syncWorkspace();if(activeTask===owner)$('result-title').focus();}
function hideResult(){resultAvailable=false;syncWorkspace();}
function setFix(visible){fixAvailable=visible;syncWorkspace();}
for(const task of ['single','batch','history'])$('nav-'+task).onclick=()=>setTask(task);
async function api(action, body = {}, signal) {
 const id=trackedActions.has(action)?crypto.randomUUID():null;
 if(id){ownedOperationId=id;ownedOperationKind=action;renderLocks();}
 try{
  let response;try{response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-SkillSync-Client':nonce},body:JSON.stringify(id?{...body,operationId:id}:body),signal});}
  catch{throw new Error('无法连接本机服务，请确认核验台已启动后重试。');}
  let data;try{data=await response.json();}catch{throw new Error('服务响应不完整，请重新打开核验台后重试。');}
  if(response.status===403)throw new Error('核验台会话已失效，请重新打开页面后重试。');
  if(!response.ok)throw new Error(data.error||'请求未完成，请重试。');
  if(id&&(operationDisposed||ownedOperationId!==id))throw new Error('页面状态已改变，旧操作回应仅保留在历史，不恢复处理权限。');
  if(id&&data.operationId!==id)throw new Error('操作回应编号未能核对，请先查看后台状态和历史，原文件未重试。');
  return data;
 }finally{if(id&&ownedOperationId===id){ownedOperationId=null;ownedOperationKind=null;renderLocks();}}
}

// Keep one bounded report string and one fresh opaque browsing context.
let reportHtml='';
function mountReport(){
 const frame=document.createElement('iframe');frame.id='report';frame.title='核验报告';frame.setAttribute('sandbox','');
 frame.srcdoc=reportHtml;$('report').replaceWith(frame);
}
function showReport(html){reportHtml=html.replaceAll('href="#','href="about:srcdoc#');if(!$('result').hidden)mountReport();}
function clearReport(){ $('structured-report').textContent='打开一份已保存的核验记录后查看。';$('structured-details').open=false;summaryCanPlan=false;if(!reportHtml)return;reportHtml='';$('report').srcdoc='';}
function status(text){ $('status').textContent = text; }
function renderLocks(){const value=localBusy||checkingOperation||Boolean(observedOperation)||Boolean(ownedOperationId),applying=localApplying; busy=value; ['verify','plan','result-recheck','result-details','mode-skill','mode-artifacts','reverify','choose','choose-contract','root','contract','kind','delivery','history-refresh','batch-plan','batch-preview','batch-recover','batch-output','batch-previous','batch-retry','batch-package','batch-digest','batch-open','choose-batch-plan','choose-batch-package'].forEach(id => $(id).disabled=value); $('batch-run').disabled=value||!batchReady; document.querySelectorAll('.history-open').forEach(button=>button.disabled=value||historyLoading); ['history-query','history-kind','history-exit','history-filter','history-clear','history-refresh'].forEach(id=>$(id).disabled=value||historyLoading); $('history-prev').disabled=value||historyLoading||historyOffset===0; $('history-next').disabled=value||historyLoading||historyOffset+12>=historyTotal; $('export-summary').disabled=value||!historyId;$('export-json').disabled=value||!historyId;$('load-example').disabled=value; $('cancel').disabled=checkingOperation||!(observedOperation?.cancellable||ownedOperationId&&['verify','plan','batch/run'].includes(ownedOperationKind)&&!applying); $('confirm').disabled=value||!planId; $('apply').disabled=value || !$('confirm').checked || !planId; $('plan').disabled=value||!selected||!summaryCanPlan; syncHistoryCompareControls(); document.querySelectorAll('.history-compare-pick').forEach(button=>button.disabled=value||historyLoading); }
function lock(value,applying=false){localBusy=value;localApplying=value&&applying;renderLocks();}
function clearPlan(){$('fix-title').textContent='审阅修复计划';planId=null;$('confirm').checked=false;setFix(false);$('changes').textContent='';$('apply').disabled=true;}
function invalidate(){ $('structured-report').textContent='尚未核验';$('export-json').disabled=true; $('plan').disabled=true;$('plan').hidden=true;fieldError('root','');fieldError('contract','');selected=null; planId=null; baselineId=null; historyId=null; $('comparison').textContent=''; $('export-summary').disabled=true; hideResult(); setFix(false); $('confirm').checked=false; clearReport(); status('目录或模式已更改，请重新核验'); }
['root','contract'].forEach(id=>$(id).addEventListener('input',()=>{invalidate();syncMode();}));
['kind','delivery'].forEach(id=>$(id).addEventListener('change',()=>{invalidate();syncMode();}));
function syncMode(){const artifacts=$('kind').value==='artifacts';$('mode-skill').checked=!artifacts;$('mode-artifacts').checked=artifacts;$('contract-fields').hidden=!artifacts;$('root-label').textContent=artifacts?'交付目录':'Skill 根目录或包含 Skills 的目录';$('root').placeholder=artifacts?'/project/artifacts…':'/project/my-skill…';$('mode-help').textContent=artifacts?'需要交付目录和验收清单（YAML / JSON）。如使用 SkillTape 交付，请勾选 delivery.json 模式。':'首次使用建议选择直接包含 SKILL.md 的目录。这里只检查文件，不运行 Skill。';}
for(const [id,kind] of [['mode-skill','skill'],['mode-artifacts','artifacts']])$(id).onchange=()=>{if($(id).checked){$('kind').value=kind;invalidate();syncMode();}};
function fieldError(id,message){$(id+'-error').textContent=message;$(id).setAttribute('aria-invalid',String(Boolean(message)));if(message)$(id).focus();}
function validateInputs(){fieldError('root','');fieldError('contract','');if(!$('root').value.trim()){fieldError('root',$('kind').value==='artifacts'?'请选择或填写交付目录。':'请选择或填写 Skill 目录。');return false;}if($('kind').value==='artifacts'&&!$('contract').value.trim()){fieldError('contract','交付验收需要一份 YAML 或 JSON 清单，请选择清单文件。');return false;}return true;}
function showTaskSummary(value){$('task-summary').hidden=false;summaryCanPlan=Boolean(value?.canPlan)&&!value?.readOnly;$('summary-title').textContent=value?.title||'核验结果';$('summary-next').textContent=value?.description||'查看完整报告后，再决定下一步。';$('summary-counts').replaceChildren();for(const item of (value?.counts||[])){const li=document.createElement('li');li.textContent=item.label+'：'+item.count;$('summary-counts').append(li);}$('plan').hidden=!summaryCanPlan;$('plan').disabled=busy||!selected||!summaryCanPlan;}
$('result-details').onclick=()=>{$('report').scrollIntoView?.({block:'start',behavior:'auto'});$('report').focus();};
$('result-recheck').onclick=()=>{if(busy)return;setTask('single');return verify(false);};
syncMode();
for(const [button,field] of [['choose','root'],['choose-contract','contract']]) $(button).onclick=async()=>{ lock(true,true); status('请在系统窗口中选择；取消后也可直接填写完整路径。'); try { const data=await api('choose',{file:field==='contract'}); $(field).value=data.path; invalidate(); } catch(e){status(e.message);} finally{lock(false);} };
async function verify(recheck=false){ if(busy||!validateInputs())return;clearPlan();hideResult();clearReport();selected=null;$('plan').hidden=true;lock(true); status(recheck?'正在重新核验…':'正在核验…'); try {
 if(!recheck){ await api('select',{path:$('root').value,kind:$('kind').value,contract:$('contract').value,delivery:$('delivery').checked,...(baselineId?{baselineId}:{})}); planId=null; setFix(false); $('confirm').checked=false; }
 const data=await api('verify'); selected=true; historyId=data.historyId; baselineId=data.baselineId; planId=null; $('confirm').checked=false; setFix(false); showComparison(data.comparison); await loadHistory(true); revealResult('single'); showReport(data.html); showTaskSummary(data.summary); status((recheck?'重新核验完成':'核验完成')+' · '+data.status); if(recheck) $('receipt').textContent='最新核验：'+data.status;
 }catch(e){status(e.message);}finally{lock(false);} }
$('verify').onclick=()=>verify(); $('reverify').onclick=()=>verify(true);
$('cancel').onclick=async()=>{const id=observedOperation?.id||ownedOperationId;if(!id){status('当前操作尚未核对，请先检查后台状态。');return;}try{await api('cancel',{operationId:id});status('已请求取消，等待准备或核验器退出；结果以回执为准。');if(observedOperation){observedOperation={...observedOperation,cancellable:false};renderLocks();}}catch(e){status(e.message);}};
$('plan').onclick=async()=>{if(!selected||!summaryCanPlan)return;clearPlan();lock(true);try{const data=await api('plan');planId=data.id; $('changes').textContent=data.description; setFix(true); $('confirm').checked=false; $('receipt').textContent='确认应用后才会修改文件。'; status('计划已生成，请审阅'); await loadHistory(true);}catch(e){status(e.message);}finally{lock(false);}};
$('confirm').onchange=()=>{$('apply').disabled=busy||!$('confirm').checked||!planId;};
$('apply').onclick=async()=>{
 if(busy||!planId||!$('confirm').checked)return;
 const id=planId;planId=null;summaryCanPlan=false;$('plan').hidden=true;$('confirm').checked=false;lock(true,true);$('fix-title').textContent='应用结果与复查';
 showTaskSummary({title:'正在应用已审阅的计划',description:'完成后仍须重新核验当前目录。',counts:[],canPlan:false});
 try{const data=await api('apply',{id,confirm:true});$('receipt').textContent=data.message;showTaskSummary({title:'已应用并备份，待重新核验',description:'刚才的报告保留为历史依据。请重新核验当前文件后再决定下一步。',counts:[],canPlan:false});status('已备份并应用，请重新核验');await loadHistory(true);}
 catch(e){$('receipt').textContent=e.message;showTaskSummary({title:'应用结果待核对',description:'原计划已失效。请查看保存的回执或重新核验当前目录，不要重复应用旧计划。',counts:[],canPlan:false});status(e.message+'；请重新核验当前目录');}
 finally{lock(false);}
};

function syncHistoryCompareControls(){
 $('history-compare').disabled=busy||historyCompareLoading;
 $('history-compare-before').disabled=busy;$('history-compare-after').disabled=busy;
 $('history-compare-cancel').hidden=!historyCompareLoading;
}
function clearHistoryComparison(){
 historyCompareController?.abort();historyCompareController=null;historyCompareSerial++;historyCompareLoading=false;
 $('history-compare-info').textContent='';$('history-compare-result').replaceChildren();$('history-compare-result').hidden=true;syncHistoryCompareControls();
}
const historyReasons={'not-verification':'只比较已存核验报告，计划或应用回执不能替代核验结果。','selection-changed':'两份记录的目录或核验方式不同，不能按同一范围对照。','declared-targets-changed':'两份报告声明的核验目标不同。','incomplete-evidence':'证据不完整或达到容量上限，没有生成零变化结论。','invalid-evidence':'历史报告结构或记录关联无效，原材料保留。','contract-changed':'契约摘要缺失或不同，不能按相同声明对照。','check-declarations-changed':'两份交付报告声明的检查项不同。'};
const historyChangeLabels={added:'新增',ongoing:'仍存在',resolved:'较晚记录未出现',changed:'同类证据变化',improved:'记录检查改善',regressed:'记录检查回退'};
function renderHistoryComparison(data,before,after){
 if(!data||data.schema!=='skillsync.history-comparison/v1'||data.before?.id!==before||data.after?.id!==after||data.readOnly!==true||data.execution!=='not-run'||data.provenance!=='not-authenticated'||!['skill','artifacts'].includes(data.kind))throw new Error('历史对照响应不完整，请重新选择两份记录。');
 if(data.status==='unavailable'){$('history-compare-info').textContent='历史记录不可比较：'+(historyReasons[data.reason]||'材料无法完整比较，请检查两份原记录。');return;}
 const keys=data.kind==='skill'?['added','ongoing','resolved','changed']:['added','ongoing','resolved'];
 if(data.status!=='compared'||!data.counts||!keys.every(key=>Number.isSafeInteger(data.counts[key])&&data.counts[key]>=0&&data.counts[key]<=256)||!Array.isArray(data.details)||data.details.length>32||!Number.isSafeInteger(data.detailsTotal)||data.detailsTotal<0||data.detailsTotal>512||data.details.length!==Math.min(data.detailsTotal,32)||data.detailsTruncated!==(data.detailsTotal>data.details.length)||data.details.some(row=>!row||typeof row.code!=='string'||row.code.length>128||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(row.code)||!Object.hasOwn(historyChangeLabels,row.change)||!Number.isSafeInteger(row.count)||row.count<1||row.count>256))throw new Error('历史对照响应不完整，请重新选择两份记录。');
 const result=$('history-compare-result'),summary=document.createElement('dl');summary.className='history-comparison-counts';
 for(const key of keys){const row=document.createElement('div'),name=document.createElement('dt'),value=document.createElement('dd');name.textContent=historyChangeLabels[key];value.textContent=String(data.counts[key]);row.append(name,value);summary.append(row);}result.append(summary);
 if(data.details.length){const list=document.createElement('ul');for(const item of data.details){const row=document.createElement('li'),code=document.createElement('code'),text=document.createElement('span');code.textContent=item.code;text.textContent=' · '+historyChangeLabels[item.change]+' · '+item.count;row.append(code,text);list.append(row);}result.append(list);}
 if(data.detailsTruncated){const note=document.createElement('p');note.textContent='显示 '+data.details.length+'/'+data.detailsTotal+' 类明细，汇总仍覆盖已接受的完整范围。';result.append(note);}
 result.hidden=false;$('history-compare-info').textContent='历史证据对照已完成；没有重新核验当前目录。';
}
$('history-compare').onclick=async()=>{
 if(busy||historyCompareLoading)return;
 clearHistoryComparison();const before=$('history-compare-before').value.trim(),after=$('history-compare-after').value.trim();
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(before)||!uuid.test(after)||before===after){$('history-compare-info').textContent='请选择两份不同的有效历史记录编号。';return;}
 const serial=historyCompareSerial,controller=new AbortController();historyCompareController=controller;historyCompareLoading=true;syncHistoryCompareControls();$('history-compare-info').textContent='正在只读核对两份历史材料…';
 try{const data=await api('history/compare',{beforeId:before,afterId:after},controller.signal);if(serial===historyCompareSerial&&!controller.signal.aborted)renderHistoryComparison(data,before,after);}
 catch(error){if(serial===historyCompareSerial&&!controller.signal.aborted)$('history-compare-info').textContent=error.message;}
 finally{if(serial===historyCompareSerial){historyCompareController=null;historyCompareLoading=false;syncHistoryCompareControls();}}
};
$('history-compare-cancel').onclick=()=>{clearHistoryComparison();$('history-compare-info').textContent='已取消历史对照，原记录未改变。';};
for(const name of ['before','after']){const field=$('history-compare-'+name);field.addEventListener('input',clearHistoryComparison);field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('history-compare').click();}});}

function showComparison(value){ $('comparison').textContent=!value?'此次结果可作为后续复查基线。':value.status==='compared'?'与基线相比：新增 '+value.added+' · 仍然存在 '+value.ongoing+' · 证据变化 '+(value.changed||0)+' · 本次不再出现 '+value.resolved:'基线无法比较：范围已变化或证据不完整。'; }
function showHistoryFilters(){ $('history-query').value=historyFilters.query; $('history-kind').value=historyFilters.kind||''; $('history-exit').value=historyFilters.exitCode===undefined?'':String(historyFilters.exitCode); }
async function loadHistory(newest=false, filters=historyFilters, offset=newest?0:historyOffset){
 if(historyLoading){if(newest)historyRefreshQueued=true;return;}historyLoading=true;renderLocks();
 try{ const data=await api('history',{offset,...filters}); historyTotal=data.total;historyOffset=offset;historyFilters=filters;showHistoryFilters();
 // At most 12 metadata rows; unchanged refreshes keep existing elements and listeners.
 const signature=JSON.stringify(data.items); if(signature!==renderedHistory){ $('history-list').replaceChildren();
 for(const item of data.items){const row=document.createElement('p'), label=document.createElement('span'), button=document.createElement('button');
 label.textContent=new Date(item.createdAt).toLocaleString()+' · '+({verify:'核验',plan:'修复计划','apply-intent':'应用请求',apply:'应用回执'}[item.kind])+' · '+item.label+' '; button.type='button';button.className='history-open';button.textContent=item.kind==='verify'?'查看并设为基线':'查看'; button.disabled=busy||historyLoading;
 button.onclick=async()=>{lock(true,true);try{const data=await api('history/open',{id:item.id}); selected=null;planId=null;baselineId=data.baselineId||null;historyId=data.id;$('root').value=data.selection.path;$('kind').value=data.selection.kind;$('contract').value=data.selection.contract||'';$('delivery').checked=data.selection.delivery;syncMode();$('confirm').checked=false;setFix(false);$('plan').hidden=true;revealResult('history');showReport(data.html);showComparison(data.comparison);showTaskSummary(data.summary);status('正在查看历史记录；点击“核验目录”检查当前文件。');}catch(e){status(e.message);}finally{lock(false);}};
 row.setAttribute('data-history-id',item.id);row.append(label,button);
 if(item.kind==='verify')for(const [side,text]of [['before','设为较早'],['after','设为较晚']]){const pick=document.createElement('button');pick.type='button';pick.className='history-compare-pick';pick.textContent=text;pick.disabled=busy||historyLoading;pick.setAttribute('aria-label','将记录 '+item.id+' '+text);pick.onclick=()=>{$('history-compare-'+side).value=item.id;clearHistoryComparison();};row.append(pick);}
 $('history-list').append(row);}
 renderedHistory=signature; }
 $('history-info').textContent=data.total+' 条匹配记录 · 保存文件 '+data.capacity.files+'/'+data.capacity.maxFiles+(data.unavailable?' · '+data.unavailable+' 条索引无法读取（不参与筛选）':'');
 $('history-prev').disabled=busy||historyOffset===0;$('history-next').disabled=busy||historyOffset+12>=historyTotal;
 }catch(e){$('history-info').textContent='历史暂不可用，保留上次结果与筛选条件，原文件未删除。';showHistoryFilters();}finally{historyLoading=false;renderLocks();if(historyRefreshQueued){historyRefreshQueued=false;await loadHistory(true);}}
}
$('history-refresh').onclick=()=>loadHistory(true);
$('history-prev').onclick=()=>{if(historyLoading)return;return loadHistory(false,historyFilters,Math.max(0,historyOffset-12));};
$('history-next').onclick=()=>{if(historyLoading)return;return loadHistory(false,historyFilters,historyOffset+12);};
$('history-filter').onclick=()=>{if(historyLoading||busy)return;const filters={query:$('history-query').value.trim(),...($('history-kind').value?{kind:$('history-kind').value}:{}),...($('history-exit').value!==''?{exitCode:Number($('history-exit').value)}:{})};return loadHistory(true,filters);};
$('history-clear').onclick=()=>{if(historyLoading||busy)return;return loadHistory(true,{query:''});};
$('history-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('history-filter').click();}});

$('load-example').onclick=async()=>{if(busy)return;lock(true,true);try{const data=await api('example');$('root').value=data.path;$('kind').value='skill';invalidate();syncMode();status('示例目录已填入。点击核验目录查看结果；不会执行 Skill。');}catch(e){status(e.message);}finally{lock(false);}};
async function readStructured(){if(!historyId)throw new Error('请先完成核验或打开历史记录。');return api('history/json',{id:historyId});}
$('structured-details').addEventListener('toggle',async()=>{if(!$('structured-details').open||busy)return;try{$('structured-report').textContent='正在读取已存证据…';const data=await readStructured();$('structured-report').textContent=JSON.stringify(data,null,2);}catch(e){$('structured-report').textContent=e.message;}});
$('export-json').onclick=async()=>{if(busy)return;lock(true,true);try{const data=await readStructured();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='skillsync-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出已存核验，没有重新执行。');}catch(e){status(e.message);}finally{lock(false);}};
$('export-summary').onclick=async()=>{lock(true,true);try{const data=await api('history/export',{id:historyId});const url=URL.createObjectURL(new Blob([data.html],{type:'text/html;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='skillsync-comparison.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message);}finally{lock(false);}};
function clearBatchContext(){recoveryPath=null;$('batch-recovery').hidden=true;$('batch-receipt').textContent='';clearPlan();selected=null;historyId=null;baselineId=null;$('plan').hidden=true;setFix(false);$('export-summary').disabled=true;$('comparison').textContent='';hideResult();clearReport();}
$('batch-plan').addEventListener('input',()=>{batchReady=false;$('batch-run').disabled=true;$('batch-info').textContent='计划已改变，请重新预检。';});
for(const [button,field]of [['choose-batch-plan','batch-plan'],['choose-batch-package','batch-package'],['choose-batch-contract','batch-contract']])$(button).onclick=async()=>{lock(true,true);try{const data=await api('choose',{file:true});$(field).value=data.path;if(field==='batch-package'||field==='batch-contract')batchPackageEdited();if(field==='batch-plan'){batchReady=false;$('batch-info').textContent='请选择预检。';}}catch(e){status(e.message);}finally{lock(false);}};
$('batch-preview').onclick=async()=>{clearBatchContext();batchReady=false;lock(true);status('正在预检多批次计划…');try{const data=await api('batch/preview',{path:$('batch-plan').value});batchReady=true;$('batch-output').value=data.suggestedOutput;$('batch-info').textContent=data.batches.map(item=>item.id+' · '+item.files+' 文件 / '+item.bytes+' 字节'+(item.available?'':' · 来源不可用')).join('；');status('计划预检完成，尚未生成复核包。');}catch(e){status(e.message);}finally{lock(false);}};
function batchPackageEdited(){clearBatchContext();status('复核包或原契约路径已改变，请重新检查。手动输入的预期摘要会保留并用于下一次复核。');}
$('batch-package').addEventListener('input',batchPackageEdited);
$('batch-contract').addEventListener('input',batchPackageEdited);
$('batch-digest').addEventListener('input',()=>{clearBatchContext();status('预期摘要已改变，请重新检查所选包。');});
function showBatch(data){$('task-summary').hidden=true;$('plan').hidden=true;setFix(false);const c=data.summary.counts;$('batch-receipt').textContent='复核包完整性已验证 · 通过 '+c.passed+' · 失败 '+c.failed+' · 不完整 '+c.incomplete+' · SHA-256 '+data.package_sha256;status('已读取有界验收证据；原始数据未在打开时重新核验，作者未认证。');revealResult('batch');showReport(data.html);}
function offerBatchRecovery(path,message){
 recoveryPath=typeof path==='string'&&path.trim()&&path.length<=4096&&!/[\u0000-\u001f]/.test(path)?path:null;
 $('batch-recovery').hidden=!recoveryPath;if(!recoveryPath)return;
 $('batch-package').value=recoveryPath;$('batch-recovery-state').textContent=message+' 此次输出：'+recoveryPath+'。先只读检查可能已生成的包；文件不存在时会明确说明，原输出不会被覆盖。';
}
$('batch-run').onclick=async()=>{const output=$('batch-output').value;clearBatchContext();batchReady=false;lock(true);status('正在逐批核验并生成新复核包…');try{const data=await api('batch/run',{path:$('batch-plan').value,output,previous:$('batch-previous').value,retryFailed:$('batch-retry').checked});$('batch-package').value=data.packagePath;showBatch(data);}catch(e){status(e.message);offerBatchRecovery(output,e.message);}finally{lock(false);}};
$('batch-recover').onclick=async()=>{if(busy||!recoveryPath)return;const path=recoveryPath;lock(true);status('正在只读核对此次输出…');try{showBatch(await api('batch/open',{path,expectSha256:'',contract:$('batch-contract').value||undefined}));$('batch-package').value=path;recoveryPath=null;$('batch-recovery').hidden=true;}catch(e){$('batch-recovery-state').textContent=e.message+'；路径保留，可稍后再检查。';status(e.message);}finally{lock(false);}};
$('batch-open').onclick=async()=>{clearBatchContext();batchReady=false;lock(true);status('正在复核已保存的包…');try{showBatch(await api('batch/open',{path:$('batch-package').value,expectSha256:$('batch-digest').value,contract:$('batch-contract').value||undefined}));}catch(e){status(e.message);}finally{lock(false);}};
function validOperationStatus(value){
 if(!value||value.schema!=='skillsync.workbench-operation/v1'||value.readOnly!==true||!Object.hasOwn(value,'active')||!Object.hasOwn(value,'last'))return false;
 const basic=v=>v&&operationUUID(v.id)&&Object.hasOwn(operationLabels,v.kind)&&Number.isSafeInteger(v.startedAt)&&v.startedAt>0;
 if(value.active!==null&&(!basic(value.active)||!['preparing','running','finalizing','applying'].includes(value.active.phase)||typeof value.active.cancellable!=='boolean'||typeof value.active.cancelRequested!=='boolean'))return false;
 if(value.last!==null&&(!basic(value.last)||!Number.isSafeInteger(value.last.finishedAt)||value.last.finishedAt<value.last.startedAt||!['completed','failed','cancelled','unconfirmed'].includes(value.last.outcome)||(value.last.historyId!==undefined&&!operationUUID(value.last.historyId))))return false;
 return true;
}
function stopOperationPolling(){if(operationTimer!==null){clearTimeout(operationTimer);operationTimer=null;}}
function scheduleOperationPolling(){
 stopOperationPolling();if(operationDisposed||document.hidden||!observedOperation||checkingOperation)return;
 if(operationReads>=90){$('operation-state').textContent+=' 自动读取已暂停，请手动检查；后台操作未自动取消。';return;}
 operationTimer=setTimeout(()=>{operationTimer=null;void checkOperation(false);},2000);
}
async function checkOperation(reset=true){
 if(operationDisposed||ownedOperationId)return;if(reset)operationReads=0;stopOperationPolling();operationController?.abort();
 const controller=new AbortController();operationController=controller;operationReads++;checkingOperation=true;$('operation-check').disabled=true;renderLocks();
 try{
  const value=await api('operation',{},controller.signal);
  if(operationController!==controller||controller.signal.aborted||operationDisposed||ownedOperationId)return;
  if(!validOperationStatus(value))throw new Error('后台状态回应无法核对，请重新打开核验台。');
  checkingOperation=false;const previous=observedOperation;
  if(value.active){
   if(!previous||previous.id!==value.active.id){clearPlan();clearReport();hideResult();selected=null;baselineId=null;historyId=null;batchReady=false;summaryCanPlan=false;}
   observedOperation=value.active;
   const phase={preparing:'正在准备',running:'仍在后台进行',finalizing:'正在保存结果',applying:'正在写入，暂不可取消'}[value.active.phase];
   $('operation-state').textContent=operationLabels[value.active.kind]+' · '+(value.active.cancelRequested?'已请求取消，等待退出':phase)+'。这里只恢复状态，不恢复旧处理计划或勾选确认。';
  }else{
   observedOperation=null;
   const ended=value.last&&(!previous||value.last.id===previous.id)?value.last:null;const words={completed:'操作请求已结束，核验结论以报告为准。',failed:'上次操作未完成。',cancelled:'上次取消请求已收口。',unconfirmed:'上次写入或批次输出结果尚未确认。'};
   $('operation-state').textContent=ended?words[ended.outcome]+' 请到历史或原输出位置查看保留证据，重新选择后再核验；不会自动重跑。':'后台当前空闲。重启前或未确认的写入仍需查看历史并重新核验。';
   if(previous)void loadHistory(true);
  }
 }catch(error){
  if(operationController===controller&&!controller.signal.aborted&&!operationDisposed){checkingOperation=true;if(observedOperation)observedOperation={...observedOperation,cancellable:false};$('operation-state').textContent=error.message+' 后台状态未确认，原文件与输入保留；请检查后再继续。';}
 }finally{if(operationController===controller){operationController=null;$('operation-check').disabled=false;renderLocks();scheduleOperationPolling();}}
}
$('operation-check').onclick=()=>checkOperation();
window.addEventListener('pagehide',()=>{operationDisposed=true;stopOperationPolling();operationController?.abort();operationController=null;ownedOperationId=null;ownedOperationKind=null;clearHistoryComparison();clearPlan();clearReport();hideResult();selected=null;baselineId=null;historyId=null;batchReady=false;});
window.addEventListener('pageshow',event=>{if(event.persisted){operationDisposed=false;localBusy=false;localApplying=false;ownedOperationId=null;ownedOperationKind=null;checkingOperation=true;void checkOperation();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopOperationPolling();operationController?.abort();operationController=null;}else if(!ownedOperationId)void checkOperation();});
syncWorkspace();
renderLocks();
loadHistory();
void checkOperation();
`;
