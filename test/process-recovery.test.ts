import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from '../src/adapters/process.js';
test('an already cancelled command never spawns its executable',async()=>{
  const signal=AbortSignal.abort();
  const result=await command('/nonexistent-aegean-command',[],{signal});
  assert.equal(result.interrupted,true);assert.equal(result.termination,'aborted');
});
test('normal parent exit cannot report success while a same-group descendant survives',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aegean-normal-exit-'));const ready=join(dir,'ready');let pid:number|undefined;
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`;
  const parent=`const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});c.unref();const t=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(ready)})){clearInterval(t);process.exit(0);}},10);`;
  try{
    const result=await command(process.execPath,['-e',parent],{timeoutMs:5000});pid=Number(await readFile(ready,'utf8'));
    assert.equal(result.interrupted,true);assert.equal(result.termination,'descendant-survived');
    let alive=true;const end=Date.now()+1000;while(alive&&Date.now()<end){try{process.kill(pid,0);}catch{alive=false;}if(alive)await new Promise(r=>setTimeout(r,10));}
    assert.equal(alive,false);
  }finally{if(pid)try{process.kill(pid,'SIGKILL');}catch{}await rm(dir,{recursive:true,force:true});}
});
test('termination waits for a descendant that ignores TERM after its parent exits',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aegean-process-tree-')); const ready=join(dir,'ready');let pid:number|undefined;
  const controller=new AbortController();
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`;
  const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const running=command(process.execPath,['-e',parent],{signal:controller.signal,timeoutMs:8000});
  try{
    const end=Date.now()+5000;while(!pid){try{pid=Number(await readFile(ready,'utf8'));}catch{if(Date.now()>end)throw new Error('descendant did not become ready');await new Promise(r=>setTimeout(r,10));}}
    controller.abort();const result=await running;assert.equal(result.interrupted,true);
    let alive=true;const deadline=Date.now()+1000;while(alive&&Date.now()<deadline){try{process.kill(pid,0);}catch{alive=false;}if(alive)await new Promise(r=>setTimeout(r,10));}
    assert.equal(alive,false,'descendant survived command completion');
  }finally{controller.abort();if(pid)try{process.kill(pid,'SIGKILL');}catch{}await running;await rm(dir,{recursive:true,force:true});}
});
