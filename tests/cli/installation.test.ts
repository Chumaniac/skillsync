import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { readBuildInfo } from '../../src/cli/commands/installation';
import { runCli } from '../../src/cli/index';
import { CURRENT_CAPABILITIES } from '../../src/capabilities';
import { VERSION } from '../../src/version';
it('installed metadata is bounded, version-bound and rejects links or altered capabilities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'skillsync-install-info-')),path=join(root,'build-info.json'),url=pathToFileURL(path);
 const value={schema:'skillsync.build-info/v1',version:VERSION,artifactKind:'source-build',sourceRevision:'a'.repeat(40),dirty:false,capabilities:CURRENT_CAPABILITIES};
 await writeFile(path,JSON.stringify(value));expect((await readBuildInfo(url))?.sourceRevision).toBe('a'.repeat(40));
 const link=join(root,'linked.json');await symlink(path,link);expect(await readBuildInfo(pathToFileURL(link))).toBe(null);
 await writeFile(path,JSON.stringify({...value,capabilities:[]}));expect(await readBuildInfo(url)).toBe(null);
 await writeFile(path,'x'.repeat(16385));expect(await readBuildInfo(url)).toBe(null);
});
it('capability inspection makes no source/permission assertion for a requested unknown commit',async()=>{
 const result=await runCli(['capabilities','--json']);expect(result.exitCode).toBe(0);
 const info=JSON.parse(result.stdout);expect(info.networkAccess).toBe(false);expect(info.executionAuthority).toBe('not-granted');expect(info.templateDefault.packageVersion).toBe('0.1.0');
 const mismatch=await runCli(['capabilities','--expect-source','a'.repeat(40),'--json']);expect(mismatch.exitCode).not.toBe(0);expect(mismatch.stderr).toMatch(/source/i);
});
