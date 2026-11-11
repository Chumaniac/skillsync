// Synthetic-only baseline. Keep both scans: they are a mutation boundary.
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,open,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import process from 'node:process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const moduleUrl=pathToFileURL(join(repository,'dist/sandbox/workspace-tree.js')).href;
const root=await realpath(await mkdtemp(join(tmpdir(),'skillsync-scan-benchmark-')));
const cases=[{name:'small',files:16,bytesPerFile:256},
 {name:'near-byte-limit',files:4,bytesPerFile:16*1024*1024},
 {name:'near-file-limit',files:9999,bytesPerFile:0}];
const child=`
 import {scanStagedWorkspace} from ${JSON.stringify(moduleUrl)};
 const directory=process.argv[1],samples=[];
 for(let index=0;index<3;index++){
  const cpu=process.cpuUsage(),start=performance.now();
  const before=await scanStagedWorkspace(directory),after=await scanStagedWorkspace(directory);
  if(before.digest!==after.digest)throw new Error('Synthetic workspace changed.');
  const used=process.cpuUsage(cpu);
  samples.push({elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,rssBytes:process.memoryUsage.rss()});
 }
 const elapsed=samples.map(item=>item.elapsedMs).sort((a,b)=>a-b);
 console.log(JSON.stringify({samples,p95Ms:elapsed[Math.ceil(elapsed.length*0.95)-1],
  peakRssBytes:process.resourceUsage().maxRSS*1024,scans:6}));
`;

try{
 const results=[];
 for(const fixture of cases){
  const folder=join(root,fixture.name);await mkdir(folder);
  const chunk=Buffer.alloc(Math.min(fixture.bytesPerFile,64*1024),0x78);
  for(let start=0;start<fixture.files;start+=16){
   await Promise.all(Array.from({length:Math.min(16,fixture.files-start)},async(_,offset)=>{
    const file=join(folder,String(start+offset).padStart(5,'0')+'.bin');
    if(!fixture.bytesPerFile){await writeFile(file,'',{flag:'wx',mode:0o600});return;}
    const handle=await open(file,'wx',0o600);
    try{
     for(let bytes=0;bytes<fixture.bytesPerFile;bytes+=chunk.length){
      const length=Math.min(chunk.length,fixture.bytesPerFile-bytes);let offset=0;
      while(offset<length){const result=await handle.write(chunk,offset,length-offset);if(!result.bytesWritten)throw new Error('Synthetic write made no progress.');offset+=result.bytesWritten;}
     }
    }
    finally{await handle.close();}
   }));
  }
  const output=execFileSync(process.execPath,['--input-type=module','-e',child,folder],
   {encoding:'utf8',timeout:120000,maxBuffer:64*1024});
  results.push({...fixture,totalBytes:fixture.files*fixture.bytesPerFile,...JSON.parse(output)});
 }
 const source=await readFile(join(repository,'src/sandbox/workspace-tree.ts'));
 process.stdout.write(JSON.stringify({schema:'skillsync.workspace-scan-baseline/v1',synthetic:true,
  node:process.version,platform:process.platform,arch:process.arch,
  workspaceSourceSha256:createHash('sha256').update(source).digest('hex'),
  method:'Three pairs of required before/after scans in a fresh process per case; nearest-rank p95 from three samples is descriptive only.',
  memoryScope:'Whole child-process maximum RSS, including imports. Node maxRSS KiB is converted to bytes. Not a production or long-duration measurement.',
  decision:'Retain before/after mutation checks; no cross-request cache is introduced.',results},null,2)+'\n');
}finally{await rm(root,{recursive:true,force:true});}
