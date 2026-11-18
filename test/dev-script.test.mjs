import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = pathToFileURL(resolve('scripts/dev-tasks.mjs')).href;
async function fixture(body) {
  const root = await mkdtemp(join(tmpdir(), 'aegean dev '));
  try {
    await mkdir(join(root,'scripts')); await mkdir(join(root,'tools'));
    await writeFile(join(root,'package.json'), JSON.stringify({name:'@you1anna/aegean'}));
    await writeFile(join(root,'toolchain.json'), JSON.stringify({node:process.versions.node}));
    await writeFile(join(root,'mise.toml'), `[tools]\nnode = "${process.versions.node}"\n`);
    await writeFile(join(root,'package-lock.json'),'root-lock'); await writeFile(join(root,'tools/package-lock.json'),'tools-lock');
    await body(root);
  } finally { await rm(root,{recursive:true,force:true}); }
}
test('source tasks use locked setup and stop at failure',()=>fixture(async root=>{
  const { runTask } = await import(modulePath); const calls=[];
  await runTask(root,'setup',async(file,args)=>calls.push([file,args]));
  assert.equal(calls.length,2); assert.ok(calls.every(c=>c[1][0]==='ci'&&c[1].includes('--ignore-scripts')));
  assert.equal(await readFile(join(root,'package-lock.json'),'utf8'),'root-lock');
  let count=0; await assert.rejects(runTask(root,'setup',async()=>{count++;throw Error('fixture failure');}),/fixture failure/); assert.equal(count,1);
}));
test('clean build rejects output symlinks and removes stale output only',()=>fixture(async root=>{
  const { runTask } = await import(modulePath);
  await mkdir(join(root,'dist')); await writeFile(join(root,'dist/stale.js'),'old'); await writeFile(join(root,'keep'),'keep');
  await runTask(root,'build',async()=>{}); await assert.rejects(access(join(root,'dist/stale.js'))); assert.equal(await readFile(join(root,'keep'),'utf8'),'keep');
  await symlink(join(root,'tools'),join(root,'dist')); await assert.rejects(runTask(root,'build',async()=>{}),/symlink/);
}));
test('concurrent source mutations fail and release on handled failure',()=>fixture(async root=>{
  const { runTask }=await import(modulePath); let release,started;
  const ready=new Promise(r=>started=r); const wait=new Promise(r=>release=r);
  const first=runTask(root,'setup',async()=>{started();await wait;}); await ready;
  await assert.rejects(runTask(root,'setup',async()=>{}),/locked/); release(); await first;
  await runTask(root,'check',async()=>{});
}));
test('unknown commands do not mutate the checkout',()=>fixture(async root=>{
  const { runTask }=await import(modulePath); await assert.rejects(runTask(root,'oops',async()=>{}),/unknown/);
  await assert.rejects(access(join(root,'.aegean')));
}));
test('source task waits for same-group descendants before returning',()=>fixture(async root=>{
  const {execute}=await import(modulePath);const marker=join(root,'writer');
  const child=join(root,'writer.cjs');await writeFile(child,`const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.appendFileSync(${JSON.stringify(marker)},'x');process.send('ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),30);`);
  const parent=join(root,'parent.cjs');await writeFile(parent,`const {fork}=require('node:child_process');const child=fork(${JSON.stringify(child)},[],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>{child.disconnect();child.unref();process.exit(0);});`);
  await assert.rejects(execute(process.execPath,[parent],root),/failed/);
  const before=await readFile(marker,'utf8');await new Promise(r=>setTimeout(r,150));assert.equal(await readFile(marker,'utf8'),before);
}));

test('bootstrap checks source and installs without repeating the development suite',()=>fixture(async root=>{
  await writeFile(join(root,'scripts/bootstrap.sh'),await readFile('scripts/bootstrap.sh'));
  const bin=join(root,'bin'); await mkdir(bin);
  const log=join(root,'calls');
  await writeFile(join(bin,'mise'),'#!/bin/sh\nprintf "mise %s\\n" "$*" >> "$BOOTSTRAP_TEST_LOG"\n',{mode:0o755});
  await writeFile(join(root,'scripts/dev'),'#!/bin/sh\nprintf "dev %s\\n" "$*" >> "$BOOTSTRAP_TEST_LOG"\n[ "$1" != test ]\n',{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH,BOOTSTRAP_TEST_LOG:log};
  execFileSync('/bin/sh',[join(root,'scripts/bootstrap.sh')],{env});
  const calls=await readFile(log,'utf8');
  assert.match(calls,/dev setup/); assert.match(calls,/dev check/);
  assert.match(calls,/sourceProvenance/); assert.match(calls,/scripts\/setup-verifier.mjs/); assert.match(calls,/scripts\/install.mjs/);
  assert.doesNotMatch(calls,/dev test|npm test/);
  await writeFile(log,'');
  await writeFile(join(root,'scripts/dev'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  assert.throws(()=>execFileSync('/bin/sh',[join(root,'scripts/bootstrap.sh')],{env}));
  assert.equal(await readFile(log,'utf8'),'');
}));

async function lockedRun(root, lock, owner) {
  await writeFile(join(root,'scripts/dev'),await readFile('scripts/dev'),{mode:0o755});
  const bin=join(root,'bin'); await mkdir(bin,{recursive:true});
  await writeFile(join(bin,'mise'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const dir=join(root,'.aegean',lock); await mkdir(dir,{recursive:true});
  if (owner!==undefined) await writeFile(join(dir,lock==='source-task'?'owner.json':'owner'),owner);
  const result=spawnSync('/bin/sh',[join(root,'scripts/dev'),'check'],{env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
  await access(dir);
  return result;
}
const deadPid=()=>spawnSync(process.execPath,['-e','']).pid;
test('a stale launcher lock names the dead owner and the removal command',()=>fixture(async root=>{
  const pid=deadPid(); const r=await lockedRun(root,'source-launcher',`${pid}\n`);
  assert.equal(r.status,1); assert.match(r.stderr,new RegExp(`process ${pid}, which no longer runs`)); assert.match(r.stderr,/rm -r ".*\.aegean\/source-launcher"/);
}));
test('a live launcher lock tells the user to wait and offers no removal',()=>fixture(async root=>{
  const r=await lockedRun(root,'source-launcher',`${process.pid}\n`);
  assert.equal(r.status,1); assert.match(r.stderr,new RegExp(`process ${process.pid} still runs`)); assert.doesNotMatch(r.stderr,/rm -r/);
}));
test('a launcher lock without an owner asks for investigation',()=>fixture(async root=>{
  const r=await lockedRun(root,'source-launcher');
  assert.equal(r.status,1); assert.match(r.stderr,/records no owner process\. Investigate/);
}));
test('a stale source-task lock reads the owner from owner.json',()=>fixture(async root=>{
  const pid=deadPid(); const r=await lockedRun(root,'source-task',JSON.stringify({pid,task:'check',startedAt:1}));
  assert.equal(r.status,1); assert.match(r.stderr,new RegExp(`process ${pid}, which no longer runs`)); assert.match(r.stderr,/rm -r ".*\.aegean\/source-task"/);
  await assert.rejects(access(join(root,'.aegean/source-launcher')));
}));
