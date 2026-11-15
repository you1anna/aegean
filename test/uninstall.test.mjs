import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {uninstall,assertNoUninstall} from '../scripts/uninstall-core.mjs';
async function fixture(body){
  const user=await realpath(await mkdtemp(join(tmpdir(),'aegean-uninstall-')));const data=join(user,'.local/share/aegean');
  try{
    for(const p of ['.local/bin','.agents/skills','.claude/skills','.codex','.local/state/aegean', '.local/share/aegean/releases/v1/skills/aegean'])await mkdir(join(user,p),{recursive:true});
    await symlink(join(data,'releases/v1'),join(data,'current'));
    for(const p of ['.agents/skills/aegean','.claude/skills/aegean'])await symlink(join(data,'current/skills/aegean'),join(user,p));
    await writeFile(join(user,'.local/bin/aegean'),'#!/bin/sh\n# managed-by-aegean\necho fixture\n',{mode:0o755});
    await writeFile(join(user,'.codex/AGENTS.md'),'keep before\n<!-- aegean:begin -->\nold\n<!-- aegean:end -->\nkeep after\n');
    await writeFile(join(user,'.local/state/aegean/record'),'private record');
    await body(user,data);
  }finally{await rm(user,{recursive:true,force:true});}
}
test('uninstall backs up installation and preserves private records and unrelated instructions',()=>fixture(async(user,data)=>{
  const result=await uninstall(user,async()=>{});assert.equal(result.uninstalled,true);await assert.rejects(access(data));
  await access(join(result.backup,'installation/releases/v1'));assert.equal(await readFile(join(user,'.local/state/aegean/record'),'utf8'),'private record');
  assert.equal(await readFile(join(user,'.codex/AGENTS.md'),'utf8'),'keep before\n\nkeep after\n');await assert.rejects(access(join(user,'.local/bin/aegean')));
  assert.equal((await uninstall(user,async()=>{})).repeated,true);await assertNoUninstall(user);
}));
test('unmanaged executable rejects before removal or instruction changes',()=>fixture(async(user,data)=>{
  await writeFile(join(user,'.local/bin/aegean'),'unrelated');const before=await readFile(join(user,'.codex/AGENTS.md'),'utf8');
  await assert.rejects(uninstall(user,async()=>{}),/unmanaged/);await access(data);assert.equal(await readFile(join(user,'.codex/AGENTS.md'),'utf8'),before);
}));
test('active ownership blocks uninstall before any changes',()=>fixture(async(user,data)=>{
  await assert.rejects(uninstall(user,async()=>{throw Error('active owner');}),/active owner/);await access(data);await access(join(user,'.local/bin/aegean'));
}));
test('interrupted uninstall resumes from retained journal',()=>fixture(async(user,data)=>{
  let checks=0;await assert.rejects(uninstall(user,async()=>{if(++checks===2)throw Error('interrupted fixture');}),/interrupted/);
  await assert.rejects(assertNoUninstall(user),/incomplete/);await access(data);
  const result=await uninstall(user,async()=>{});assert.equal(result.uninstalled,true);await assertNoUninstall(user);
}));
test('uninstall rejects noncanonical and duplicate journal destinations',()=>fixture(async(user,data)=>{
  let count=0;await assert.rejects(uninstall(user,async()=>{if(++count===2)throw Error('stop');}));
  const path=join(user,'.local/share/aegean-uninstall.json');const original=JSON.parse(await readFile(path,'utf8'));
  for(const changed of [{...original,backup:original.backup+'/../elsewhere'},{...original,entries:[original.entries[0],original.entries[0]]}]){
    await writeFile(path,JSON.stringify(changed));await assert.rejects(uninstall(user,async()=>{}),/invalid|duplicate/);await access(data);await access(join(user,'.local/bin/aegean'));
  }
}));
test('uninstall rejects symlinked parents without modifying the target',()=>fixture(async(user,data)=>{
  const outside=join(user,'outside');await mkdir(outside);await rm(join(user,'.local/bin'),{recursive:true});await symlink(outside,join(user,'.local/bin'));
  await writeFile(join(outside,'aegean'),'unrelated');await assert.rejects(uninstall(user,async()=>{}),/symlink/);await access(data);assert.equal(await readFile(join(outside,'aegean'),'utf8'),'unrelated');
}));
test('uninstall resumes after one managed link was already removed',()=>fixture(async(user)=>{
  let count=0;await assert.rejects(uninstall(user,async()=>{if(++count===2)throw Error('pause');}));
  const {routingAction}=await import('../scripts/routing.mjs');await routingAction(user,'migrate');
  const file=join(user,'.local/share/aegean-uninstall.json');const journal=JSON.parse(await readFile(file,'utf8'));journal.phase='routing-removed';await writeFile(file,JSON.stringify(journal));
  await rm(join(user,'.local/bin/aegean'));
  const result=await uninstall(user,async()=>{});assert.equal(result.uninstalled,true);assert.equal(await readFile(join(user,'.codex/AGENTS.md'),'utf8'),'keep before\n\nkeep after\n');
}));
