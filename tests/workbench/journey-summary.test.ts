import {expect,it} from 'vitest';import {journeySummary} from '../../src/workbench/journey-summary';
import type {VerificationReport} from '../../src/cli/commands/verify';import type {ArtifactReport} from '../../src/domain/artifact-report';
const skill={exitCode:1,summary:{fail:2,warn:1,unknown:0},issues:[{finding:{status:'fail'}}]} as VerificationReport;
it('turns current Skill evidence into a plan next-step without claiming application',()=>{const result=journeySummary('skill',skill);expect(result.canPlan).toBe(true);expect(result.counts[0].count).toBe(2);expect(result.description).toContain('明确确认');});
it('historical evidence never regains mutation authority',()=>expect(journeySummary('skill',skill,true)).toMatchObject({readOnly:true,canPlan:false}));
it('incomplete evidence never offers a repair plan',()=>{expect(journeySummary('skill',{...skill,exitCode:2}).canPlan).toBe(false);expect(journeySummary('skill',{...skill,exitCode:4}).title).toContain('尚未完整');});
it('artifact outcomes direct users to their files instead of safe-fix promises',()=>{const result=journeySummary('artifacts',{exitCode:1,files:[{}],findings:[{}],reconciliations:[]} as ArtifactReport);expect(result.canPlan).toBe(false);expect(result.description).toContain('不提供自动修改');expect(result.counts[0].count).toBe(1);});
