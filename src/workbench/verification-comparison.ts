import {z} from "zod";
import type {VerificationReport} from "../cli/commands/verify.js";
import {compareIssues} from "../domain/baseline.js";
import {issueIdForFinding} from "../domain/issue.js";
import {FindingSchema} from "../domain/result.js";

export type IssueCounts={added:number;ongoing:number;resolved:number;changed:number};
export type ComparisonDetail={code:string;change:string;count:number};
type Report=Pick<VerificationReport,"issues"|"findings"|"summary"|"exitCode">;
const text=z.string().min(1).max(4096);
const finding=FindingSchema.refine(row=>row.code.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(row.code)
 &&row.skill.length<=4096&&(row.target?.length??0)<=4096&&row.message.length<=4096&&(row.remediation?.length??0)<=4096
 &&row.evidence.length<=256&&row.evidence.every(item=>Object.keys(item).length<=32&&Object.values(item).every(value=>value.length<=4096)));
const count=z.number().int().min(0).max(256);
const schema=z.object({schema_version:z.literal(1),generated_at:z.string().datetime(),
 targets:z.array(z.object({name:text,path:text,scope:z.enum(["explicit","project","user"]),profileId:text.optional()})).min(1).max(64),
 findings:z.array(finding).max(256),issues:z.array(z.object({id:z.string().regex(/^iss_[a-f0-9]{64}$/),
 state:z.enum(["open","acknowledged","resolved","ignored","regressed"]),finding,
 location:z.object({path:text,line:z.number().int().nonnegative().safe().optional()}).passthrough().optional(),
 })).max(256),summary:z.object({total:count,pass:count,warn:count,fail:count,unknown:count}).strict(),
 exitCode:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),
});

/** Validate comparison fields; unused explanations/repair recipes are never consumed. */
export function parseComparisonReport(value:unknown) {
 // Zod arrays collect child errors even after max() fails. Reject hostile widths
 // before deep parsing, while the 8 MiB history reader remains the byte bound.
 const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
 if(!object(value)||Object.keys(value).length>16||!Array.isArray(value.targets)||value.targets.length>64
  ||value.targets.some(row=>!object(row)||Object.keys(row).length>8)
  ||!Array.isArray(value.findings)||value.findings.length>256||!Array.isArray(value.issues)||value.issues.length>256)throw new Error("History capacity");
 const candidates=[...value.findings,...value.issues.map(row=>object(row)?row.finding:undefined)];
 if(candidates.some(row=>!object(row)||Object.keys(row).length>16||!Array.isArray(row.evidence)||row.evidence.length>256
  ||row.evidence.some(item=>!object(item)||Object.keys(item).length>32||Object.values(item).some(v=>typeof v!=="string"||v.length>4096))))throw new Error("History evidence capacity");
 const parsed=schema.parse(value);
 const actual={total:parsed.findings.length,pass:0,warn:0,fail:0,unknown:0};
 for(const item of parsed.findings)actual[item.status]++;
 const expected=new Set(parsed.findings.map(item=>issueIdForFinding(item))),observed=new Set(parsed.issues.map(item=>issueIdForFinding(item.finding)));
 if(Object.keys(actual).some(key=>actual[key as keyof typeof actual]!==parsed.summary[key as keyof typeof actual])
  ||new Set(parsed.issues.map(item=>item.id)).size!==parsed.issues.length||expected.size!==observed.size||[...expected].some(key=>!observed.has(key)))throw new Error("Incomplete history findings");
 return parsed;
}

type Compared={status:"compared";counts:IssueCounts;details:ComparisonDetail[];detailsTotal:number;detailsTruncated:boolean};
type Unavailable={status:"unavailable";reason:"incomplete-evidence"};
type NeededReport=Pick<Report,"findings"|"summary"|"exitCode">&{issues:Array<Pick<Report["issues"][number],"id"|"finding"|"location">>};

/** Same owner for fresh/baseline and saved/saved comparisons. No raw messages or paths leave it. */
export function compareVerificationReports(before:NeededReport,after:NeededReport):Compared|Unavailable {
 if([before,after].some(report=>report.exitCode===2||report.exitCode===4||report.issues.length>=256||report.findings.length>=256||report.summary.unknown>0))return {status:"unavailable",reason:"incomplete-evidence"};
 const pending=(report:NeededReport)=>report.issues.filter(issue=>issue.finding.status==="fail"||issue.finding.status==="warn");
 const left=pending(before),right=pending(after),comparison=compareIssues(left,right);
 const added=new Set(comparison.newIds),absent=new Set(comparison.resolvedIds),ongoing=new Set(comparison.ongoingIds);
 const group=(issue:NeededReport["issues"][number])=>JSON.stringify([issue.finding.code,issue.finding.skill,issue.finding.target,issue.location]);
 const removed=new Map<string,Array<NeededReport["issues"][number]>>();
 for(const issue of left)if(absent.has(issue.id)){const key=group(issue),items=removed.get(key)??[];items.push(issue);removed.set(key,items);}
 const details=new Map<string,ComparisonDetail>();
 const add=(code:string,change:string)=>{const key=JSON.stringify([code,change]);const row=details.get(key)??{code,change,count:0};row.count++;details.set(key,row);};
 let changed=0;
 for(const issue of right){
  if(ongoing.has(issue.id))add(issue.finding.code,"ongoing");
  else if(added.has(issue.id)){const paired=removed.get(group(issue))?.pop();if(paired){changed++;add(issue.finding.code,"changed");}else add(issue.finding.code,"added");}
 }
 for(const items of removed.values())for(const issue of items)add(issue.finding.code,"resolved");
 const rows=[...details.values()].sort((a,b)=>a.code.localeCompare(b.code)||a.change.localeCompare(b.change));
 return {status:"compared",counts:{added:comparison.newIds.length-changed,ongoing:comparison.ongoingIds.length,resolved:comparison.resolvedIds.length-changed,changed},details:rows.slice(0,32),detailsTotal:rows.length,detailsTruncated:rows.length>32};
}
