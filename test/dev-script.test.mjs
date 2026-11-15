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
  const child=join(root,'writer.cjs');await writeFile(child,`const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),30);`);
  const parent=join(root,'parent.cjs');await writeFile(parent,`const {spawn}=require('node:child_process');const child=spawn(process.execPath,[${JSON.stringify(child)}],{stdio:'ignore'});child.unref();setTimeout(()=>process.exit(0),100);`);
  await assert.rejects(execute(process.execPath,[parent],root),/failed/);
  const before=await readFile(marker,'utf8');await new Promise(r=>setTimeout(r,150));assert.equal(await readFile(marker,'utf8'),before);
}));
