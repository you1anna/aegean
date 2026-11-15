import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setupVerifier} from '../scripts/setup-verifier.mjs';
async function fixture(body){const root=await mkdtemp(join(tmpdir(),'aegean-setup-'));try{
  const v={profile:'aegean',colima:'1.2.3',dockerClient:'4.5.6',candidateRoot:join(root,'candidates'),image:'fixture@sha256:'+'a'.repeat(64)};
  await writeFile(join(root,'toolchain.json'),JSON.stringify({verifier:v}));await mkdir(join(root,'.colima/aegean'),{recursive:true});await writeFile(join(root,'.colima/aegean/colima.yaml'),'autoActivate: false\n');
  await body(root,v);
}finally{await rm(root,{recursive:true,force:true});}}
test('fresh provisioning retains uncertain transition and releases successful or rejected preflight',()=>fixture(async(root)=>{
  let releases=0;const calls=[];
  const edges={platform:'darwin',docker:async()=>'/managed/docker',reserve:async()=>async()=>{releases++;},quiescent:async()=>{},startArgs:()=>['start','--activate=false'],run:async(file,args)=>{calls.push(args);if(args[0]==='--version')return file==='colima'?'1.2.3':'4.5.6';throw Error('uncertain start');}};
  await assert.rejects(setupVerifier(root,root,edges),/uncertain/);assert.equal(releases,0);
  await assert.rejects(setupVerifier(root,root,{...edges,quiescent:async()=>{throw Error('retained resources');}}),/retained/);assert.equal(releases,1);
  await setupVerifier(root,root,{...edges,run:async(file,args)=>args[0]==='--version'?(file==='colima'?'1.2.3':'4.5.6'):''});assert.equal(releases,2);assert.equal(await readFile(join(root,'.colima/aegean/colima.yaml'),'utf8'),'autoActivate: false\n');
}));
