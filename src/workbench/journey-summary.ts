import type { VerificationReport } from '../cli/commands/verify.js';
import type { ArtifactReport } from '../domain/artifact-report.js';
export type JourneySummary={title:string;description:string;counts:Array<{label:string;count:number}>;canPlan:boolean;readOnly:boolean};
export function journeySummary(kind:'skill'|'artifacts',report:VerificationReport|ArtifactReport,readOnly=false):JourneySummary{
 const incomplete=[2,4].includes(report.exitCode)||(kind==='artifacts'&&(report as ArtifactReport).reconciliations?.some(check=>check.status==='unknown'));
 let counts:JourneySummary['counts'],actionable=0;
 if(kind==='skill'){
  const value=report as VerificationReport;actionable=value.issues.filter(issue=>['fail','warn'].includes(issue.finding.status)).length;
  counts=[{label:'阻断问题',count:value.summary.fail},{label:'建议核对',count:value.summary.warn},{label:'尚未确认',count:value.summary.unknown}];
 }else{const value=report as ArtifactReport;counts=[{label:'已读取文件',count:value.files.length},{label:'问题定位',count:value.findings.length},{label:'未完成对账',count:value.reconciliations?.filter(check=>check.status==='unknown').length||0}];}
 const canPlan=!readOnly&&kind==='skill'&&!incomplete&&actionable>0;
 return {title:readOnly?'历史证据 · 只读':incomplete?'本次检查尚未完整':report.exitCode===0?'所声明的检查通过':'存在需要处理的项目',
  description:readOnly?'打开历史不会重新核验或恢复修复权限。可重新核验当前目录再决定下一步。':incomplete?'先查看报告中的输入、容量或未完成原因，修正后重新核验；当前结果不能作为完整通过。':kind==='artifacts'?'交付检查不提供自动修改。按报告修正原文件或清单，再明确重新检查；本报告会保留。':canPlan?'可先生成处理计划，区分安全修改与人工步骤；审阅并明确确认后才会写文件。':'可查看报告或保存摘要。继续修改文件后，请重新核验。',counts,canPlan,readOnly};
}
