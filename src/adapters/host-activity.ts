import { mkdir, lstat, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './files.js';
import { executionLock } from './run-lock.js';

async function directory(state: string) {
  await mkdir(state,{recursive:true,mode:0o700});
  const root=join(state,'host-activity');
  await mkdir(root,{recursive:true,mode:0o700});
  if((await lstat(root)).isSymbolicLink()) throw new Error('host activity directory must not be a symlink');
  return root;
}
export async function hostActivities(state: string) {
  const root=join(state,'host-activity');
  try { return (await readdir(root)).filter(n=>n.endsWith('.json')).map(name=>join(root,name)); }
  catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e; }
}
/** Short metadata lock; durable reservations cover the long operation. No stale takeover. */
export async function reserveHost(state: string, kind: 'execution'|'transition', action: string) {
  const root=await directory(state);const unlock=await executionLock(root);
  const id=`${kind}-${randomUUID()}.json`;const path=join(root,id);
  try {
    const records=await hostActivities(state);
    if(records.some(p=>kind==='transition'||p.includes('/transition-'))) throw new Error(`host operation blocked by ${records.join(', ')}; inspect owner and recover before retrying`);
    await atomicJson(path,{pid:process.pid,kind,action,startedAt:Date.now()});
  } finally {await unlock();}
  return async()=>{await rm(path);};
}
export async function recoverHostActivities(state: string, confirmed: boolean) {
  if(!confirmed)throw new Error('host recovery requires --confirm-stopped after inspection');
  const root=await directory(state);const unlock=await executionLock(root);
  try {
    const paths=await hostActivities(state);
    for(const path of paths){
      const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new Error('invalid host activity record');
      const record=JSON.parse(await readFile(path,'utf8')) as {pid:number};
      if(!Number.isSafeInteger(record.pid)||record.pid<=0)throw new Error('invalid host activity owner');
      try{process.kill(record.pid,0);throw new Error('host activity owner is still running');}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
    }
    for(const path of paths)await rm(path);
    return {recovered:paths.length,warning:'Run/resource ownership is unchanged. Inspect aegean status before resume.'};
  } finally{await unlock();}
}
