import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ensureDocker} from '../scripts/docker-client.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(body){const root=await mkdtemp(join(tmpdir(),'docker-client-'));try{
  await mkdir(join(root,'docker'));const bytes=Buffer.from('#!/bin/sh\necho "Docker version 29.9.1"\n');await writeFile(join(root,'docker/docker'),bytes);
  const archive=join(root,'fixture.tgz');execFileSync('tar',['-czf',archive,'-C',root,'docker/docker']);const compressed=await readFile(archive);
  const pin={archiveSha256:hash(compressed),binarySha256:hash(bytes)};
  const verifier={dockerClient:'29.9.1',dockerArtifacts:{arm64:pin,x64:pin}};
  const options={platform:'darwin',arch:'arm64',download:async(url,dest)=>{assert.equal(url,'https://download.docker.com/mac/static/stable/aarch64/docker-29.9.1.tgz');await writeFile(dest,compressed);}};
  await body(root,verifier,options,bytes);
}finally{await rm(root,{recursive:true,force:true});}}
test('fresh provisioning verifies archives, reuses pinned bytes and rejects corrupt clients',()=>fixture(async(root,v,o,bytes)=>{
  const binary=await ensureDocker(root,v,o);assert.deepEqual(await readFile(binary),bytes);assert.ok((await lstat(binary)).mode&0o111);
  assert.equal(await ensureDocker(root,v,{...o,download:()=>{throw Error('unexpected download');}}),binary);
  await writeFile(binary,'corrupt');await assert.rejects(ensureDocker(root,v,o),/integrity/);
}));
test('checksum and network failures clean locks and permit retry without publishing a client',()=>fixture(async(root,v,o)=>{
  await assert.rejects(ensureDocker(root,v,{...o,download:async()=>{throw Error('network');}}),/network/);
  await assert.rejects(ensureDocker(root,v,{...o,download:async(_,p)=>writeFile(p,'bad')}),/archive checksum/);
  await assert.rejects(ensureDocker(root,{...v,dockerArtifacts:{arm64:{...v.dockerArtifacts.arm64,binarySha256:'0'.repeat(64)}}},o),/binary checksum/);
  await ensureDocker(root,v,o);
}));
test('concurrent provisioning refuses a second writer; unsupported platforms fail before download',()=>fixture(async(root,v,o)=>{
  let release,started;const gate=new Promise(r=>release=r);const ready=new Promise(r=>started=r);
  const first=ensureDocker(root,v,{...o,download:async(...args)=>{started();await gate;await o.download(...args);}});
  await ready;await assert.rejects(ensureDocker(root,v,o),/busy or interrupted/);release();await first;
  await assert.rejects(ensureDocker(root,v,{...o,platform:'linux'}),/Unsupported/);
}));
