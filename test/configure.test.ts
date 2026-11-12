import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { command } from '../src/adapters/process.js';

test('configure requires exclusions and adds them without resetting host identity or billing', async () => {
  const home=await realpath(await mkdtemp(join(tmpdir(),'aegean-configure-')));
  const settings=join(home,'.local/state/aegean/settings.json');
  const cli=(args:string[])=>command(process.execPath,[resolve('dist/src/cli.js'),'configure',...args],{cwd:home,env:{...process.env,HOME:home},timeoutMs:10000});
  const initial=['--control-remote','git@github.com:fixture/verifier.git','--verifier-checkout',join(home,'verifier')];
  try{
    assert.notEqual((await cli(initial)).code,0);await assert.rejects(access(settings));
    assert.notEqual((await cli([...initial,'--exclude'])).code,0);await assert.rejects(access(settings));
    assert.notEqual((await cli([...initial,'--exclude',''])).code,0);await assert.rejects(access(settings));
    const created=await cli([...initial,'--exclude','excluded-a','--exclude','./excluded-a','--exclude','excluded-b']);
    assert.equal(created.code,0,created.stderr);const before=JSON.parse(await readFile(settings,'utf8'));
    assert.deepEqual(before.excludedRoots,[join(home,'excluded-a'),join(home,'excluded-b')]);assert.equal(before.billingConfirmed,false);
    before.billingConfirmed=true;await writeFile(settings,JSON.stringify(before));
    const added=await cli(['--exclude','excluded-c']);assert.equal(added.code,0,added.stderr);
    const after=JSON.parse(await readFile(settings,'utf8'));
    assert.deepEqual(after,{...before,excludedRoots:[...before.excludedRoots,join(home,'excluded-c')]});
    const bytes=await readFile(settings,'utf8');
    assert.notEqual((await cli(['--control-remote','git@github.com:another/verifier.git','--exclude','excluded-d'])).code,0);
    assert.notEqual((await cli(['--verifier-checkout',join(home,'other-verifier'),'--exclude','excluded-d'])).code,0);
    assert.equal(await readFile(settings,'utf8'),bytes);
    const next=await cli(['--exclude','excluded-d']);assert.equal(next.code,0,next.stderr);
  }finally{await rm(home,{recursive:true,force:true});}
});

test('configuration writers cannot lose exclusions and a retained lock fails closed',async()=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'aegean-configure-race-')));const state=join(home,'.local/state/aegean');const settings=join(state,'settings.json');
  const cli=(args:string[])=>command(process.execPath,[resolve('dist/src/cli.js'),'configure',...args],{cwd:home,env:{...process.env,HOME:home},timeoutMs:10000});
  try{
    const created=await cli(['--control-remote','git@github.com:fixture/verifier.git','--verifier-checkout',join(home,'verifier'),'--exclude','original']);assert.equal(created.code,0,created.stderr);
    const original=await readFile(settings,'utf8');await mkdir(join(state,'configuring'));
    const locked=await cli(['--exclude','blocked']);assert.notEqual(locked.code,0);assert.match(locked.stderr,/configuration.*locked/);assert.equal(await readFile(settings,'utf8'),original);
    await rm(join(state,'configuring'),{recursive:true});
    const paths=['first','second'];const results=await Promise.all(paths.map(path=>cli(['--exclude',path])));
    for(let i=0;i<results.length;i++)if(results[i]!.code!==0){assert.match(results[i]!.stderr,/configuration.*locked/);const retried=await cli(['--exclude',paths[i]!]);assert.equal(retried.code,0,retried.stderr);}
    const final=JSON.parse(await readFile(settings,'utf8'));
    assert.deepEqual(new Set(final.excludedRoots),new Set(['original',...paths].map(path=>join(home,path))));
    assert.equal(final.host,JSON.parse(original).host);await assert.rejects(access(join(state,'configuring')));
  }finally{await rm(home,{recursive:true,force:true});}
});
