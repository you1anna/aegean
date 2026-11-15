import { lstat, readFile, readlink, mkdir, rename, unlink, realpath, open } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { safeParents, routingAction, routingContext, withInstallationLock } from './routing.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=async p=>{try{return await lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const journalPath=user=>join(user,'.local/share/aegean-uninstall.json');
export async function assertNoUninstall(user){
  const path=journalPath(user);await safeParents(user,path);
  const info=await exists(path);if(!info)return;
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>65536)throw new Error('unsafe uninstall journal');
  const journal=JSON.parse(await readFile(path,'utf8'));
  if(journal.phase!=='complete')throw new Error('uninstall is incomplete; rerun the source scripts/uninstall.mjs --confirm before installation');
}
async function syncDirectory(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function atomic(path,value){const tmp=`${path}.${randomUUID()}`;const handle=await open(tmp,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}await rename(tmp,path);await syncDirectory(dirname(path));}
function validateJournal(journal,user){
  if(!journal||Object.keys(journal).sort().join(',')!=='backup,entries,phase,schemaVersion'||journal.schemaVersion!==1||!['planned','routing-removed','links-removed','complete'].includes(journal.phase)||!Array.isArray(journal.entries)||journal.entries.length>3)throw new Error('invalid uninstall journal');
  const parent=join(user,'.local/share/aegean-backups');
  if(typeof journal.backup!=='string'||resolve(journal.backup)!==journal.backup||dirname(journal.backup)!==parent||!/^uninstall-\d+-[a-f0-9-]{36}$/.test(journal.backup.slice(parent.length+1)))throw new Error('invalid uninstall backup path');
  if(new Set(journal.entries.map(e=>e.relative)).size!==journal.entries.length)throw new Error('duplicate uninstall destinations');
  for(const e of journal.entries){
    if(e.relative==='.local/bin/aegean'){
      if(Object.keys(e).sort().join(',')!=='content,hash,kind,mode,relative'||e.kind!=='file'||typeof e.content!=='string'||Buffer.byteLength(e.content)>8192||!e.content.startsWith('#!/bin/sh\n# managed-by-aegean\n')||hash(e.content)!==e.hash||!Number.isInteger(e.mode)||e.mode<0||e.mode>0o777)throw new Error('invalid uninstall executable snapshot');
    }else if(['.agents/skills/aegean','.claude/skills/aegean'].includes(e.relative)){
      if(Object.keys(e).sort().join(',')!=='kind,relative,target'||e.kind!=='symlink'||typeof e.target!=='string'||resolve(dirname(join(user,e.relative)),e.target)!==join(user,'.local/share/aegean/current/skills/aegean'))throw new Error('invalid uninstall skill snapshot');
    }else throw new Error('unknown uninstall destination');
  }
}
export async function uninstall(userRoot,quiescent){
  const user=await realpath(userRoot);const context=await routingContext(user);const data=context.data;
  const journalFile=journalPath(user);await safeParents(user,journalFile,true);
  let journal;const previous=await exists(journalFile);
  if(previous){
    if(!previous.isFile()||previous.isSymbolicLink()||previous.nlink!==1||previous.size>65536)throw new Error('unsafe uninstall journal');
    journal=JSON.parse(await readFile(journalFile,'utf8'));validateJournal(journal,user);
    if(journal.phase==='complete'){
      if(!await exists(data))return {uninstalled:true,backup:journal.backup,repeated:true};
      journal=undefined;
    }
  }
  const destinations=['.local/bin/aegean','.agents/skills/aegean','.claude/skills/aegean'];
  const snapshot=async relative=>{
    const path=join(user,relative);await safeParents(user,path);const info=await exists(path);if(!info)return null;
    if(relative==='.local/bin/aegean'){
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8192)throw new Error('refusing unmanaged aegean executable');
      const content=await readFile(path,'utf8');if(!content.startsWith('#!/bin/sh\n# managed-by-aegean\n'))throw new Error('refusing unmanaged aegean executable');
      return {relative,kind:'file',content,mode:info.mode&0o777,hash:hash(content)};
    }
    if(!info.isSymbolicLink())throw new Error('refusing unmanaged Aegean skill');
    const target=await readlink(path);if(resolve(dirname(path),target)!==join(data,'current/skills/aegean'))throw new Error('refusing unrelated skill symlink');
    return {relative,kind:'symlink',target};
  };
  if(!journal){
    const info=await exists(data);if(!info)return {uninstalled:true,backup:null,repeated:true};
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe Aegean data directory');
    await quiescent();
    await withInstallationLock(context,async()=>{
      const entries=(await Promise.all(destinations.map(snapshot))).filter(Boolean);
      for(const name of ['current','previous']){
        const path=join(data,name);const info=await exists(path);if(!info)continue;
        if(!info.isSymbolicLink())throw new Error('unsafe release pointer');
        const target=await realpath(path);if(!target.startsWith(join(data,'releases')+'/'))throw new Error('release pointer escapes managed directory');
      }
      const backup=join(user,'.local/share/aegean-backups',`uninstall-${Date.now()}-${randomUUID()}`);
      await safeParents(user,join(backup,'manifest.json'),true);
      journal={schemaVersion:1,phase:'planned',backup,entries};
      await atomic(join(backup,'manifest.json'),journal);await atomic(journalFile,journal);
    });
  }
  validateJournal(journal,user);
  await safeParents(user,join(journal.backup,'manifest.json'));
  await quiescent();
  if(journal.phase==='planned'){
    // Explicit uninstall authorises removal of only the managed instruction block.
    await routingAction(user,'migrate');journal.phase='routing-removed';await atomic(journalFile,journal);
  }
  if(journal.phase==='routing-removed'){
    await withInstallationLock(context,async()=>{
      for(const entry of journal.entries){const now=await snapshot(entry.relative);if(now&&JSON.stringify(now)!==JSON.stringify(entry))throw new Error('managed destination changed during uninstall; preserve it for review');}
      for(const entry of journal.entries){const path=join(user,entry.relative);if(await exists(path))await unlink(path);await syncDirectory(dirname(path));}
      journal.phase='links-removed';await atomic(journalFile,journal);
    });
  }
  const archived=join(journal.backup,'installation');
  if(await exists(data)){
    if(await exists(archived))throw new Error('both active and archived installations exist; manual reconciliation required');
    await rename(data,archived);await syncDirectory(dirname(data));await syncDirectory(journal.backup);
  }else if(!await exists(archived))throw new Error('uninstall installation backup missing');
  journal.phase='complete';await atomic(journalFile,journal);
  return {uninstalled:true,backup:journal.backup,preserved:['private state and run records','acceptance evidence','provider authentication','external runtimes','Colima profile and disk'],next:'Install a reviewed clean source checkout with sh scripts/bootstrap.sh'};
}
