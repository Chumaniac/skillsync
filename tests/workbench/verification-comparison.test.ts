import {describe,it,expect} from "vitest";
import {mkdtemp,stat,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {toIssue} from "../../src/domain/issue.js";
import type {Finding} from "../../src/domain/result.js";
import {artifactSetHash} from "../../src/domain/artifact-report.js";
import {WorkbenchHistory} from "../../src/workbench/history.js";
import {parseComparisonReport,compareVerificationReports} from "../../src/workbench/verification-comparison.js";

function finding(code:string,evidence="old",status:Finding["status"]="warn"):Finding{return {level:0,severity:"warn",status,code,skill:"fixture",message:"PRIVATE_FINDING_MESSAGE",evidence:[{evidence}]};}
function report(findings:Finding[]){
 const summary={total:findings.length,pass:0,warn:0,fail:0,unknown:0};for(const row of findings)summary[row.status]++;
 return {schema_version:1,generated_at:"2026-11-06T00:00:00.000Z",targets:[{name:"verify-1",path:"[local path]",scope:"explicit"}],findings,issues:findings.map(row=>toIssue(row,{})),summary,exitCode:0};
}
describe("saved verification comparison boundaries",()=>{
 it("pairs evidence changes without calling an absent warning a verified fix",()=>{
  const before=parseComparisonReport(report([finding("test.changed"),finding("test.absent"),finding("test.ongoing")]));
  const after=parseComparisonReport(report([finding("test.changed","new"),finding("test.added"),finding("test.ongoing")]));
  const result=compareVerificationReports(before,after);expect(result.status).toBe("compared");
  if(result.status!=="compared")throw new Error("comparison unavailable");
  expect(result.counts).toEqual({added:1,ongoing:1,resolved:1,changed:1});
  expect(JSON.stringify(result)).not.toContain("PRIVATE_FINDING_MESSAGE");expect(result.details).toHaveLength(4);
 });
 it("rejects duplicate identifiers, missing findings and inconsistent summaries",()=>{
  const value=report([finding("test.first"),finding("test.second")]);
  value.issues[1].id=value.issues[0].id;expect(()=>parseComparisonReport(value)).toThrow();
  value.issues.pop();expect(()=>parseComparisonReport(value)).toThrow();
  const wrong=report([finding("test.first")]);wrong.summary.total=0;expect(()=>parseComparisonReport(wrong)).toThrow();
  expect(()=>parseComparisonReport({...wrong,issues:Array(10000).fill({})})).toThrow();
 });
 it("distinguishes saturated or unknown evidence from zero changes and caps code rows",()=>{
  const empty=parseComparisonReport(report([]));
  const saturated=parseComparisonReport(report(Array.from({length:256},(_,i)=>finding("test.code"+i))));
  expect(compareVerificationReports(saturated,empty).status).toBe("unavailable");
  expect(compareVerificationReports(parseComparisonReport(report([finding("test.unknown","x","unknown")])),empty).status).toBe("unavailable");
  const detail=compareVerificationReports(parseComparisonReport(report(Array.from({length:40},(_,i)=>finding("test.code"+i)))),empty);
  if(detail.status!=="compared")throw new Error("comparison unavailable");
  expect(detail.counts.resolved).toBe(40);expect(detail.details).toHaveLength(32);expect(detail.detailsTotal).toBe(40);expect(detail.detailsTruncated).toBe(true);
 });
 it("compares offline artifact history through the existing contract-bound parser",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"sync-saved-artifact-"))),info=await stat(root),history=new WorkbenchHistory(root,`${info.dev}:${info.ino}`);
  const selection={path:"/synthetic/offline-artifacts",identity:"1:2",kind:"artifacts" as const,contract:"/synthetic/missing-contract.json",delivery:false};
  const files=[{path:"table.csv",bytes:10,sha256:"b".repeat(64)}];
  const before={schema:"skillsync.artifacts-report/v1",status:"passed",exitCode:0,evidence:"physical-files",execution:"not-run",provenance:"not-authenticated",receipt_binding:"not-provided",contract_sha256:"a".repeat(64),artifact_set_sha256:artifactSetHash(files),files,findings:[]};
  const after={...before,status:"failed",exitCode:1,findings:[{code:"csv.value-mismatch",path:"table.csv",field:"amount",message:"PRIVATE_CELL_SENTINEL"}]};
  const left=await history.append({kind:"verify",selection,exitCode:0},JSON.stringify(before)),right=await history.append({kind:"verify",selection,exitCode:1},JSON.stringify(after));
  const compared=await history.compare(left.id,right.id);expect(compared.status).toBe("compared");
  if(!("counts" in compared))throw new Error("counts unavailable");
  expect(compared.counts.added).toBe(1);expect(JSON.stringify(compared)).not.toContain("PRIVATE_CELL_SENTINEL");expect(JSON.stringify(compared)).not.toContain(selection.path);
  const changed=await history.append({kind:"verify",selection,exitCode:1},JSON.stringify({...after,contract_sha256:"c".repeat(64)}));
  const unavailable=await history.compare(left.id,changed.id);expect(unavailable.status).toBe("unavailable");expect(unavailable).not.toHaveProperty("counts");
 });
});
