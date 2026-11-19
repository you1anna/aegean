import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { RUN_ID, createRun } from '../domain/run.js';
import { digest } from '../domain/digest.js';
import { POLICY } from '../domain/workflow-policy.js';
import { atomicJson } from '../adapters/files.js';
import { GitLedger } from '../adapters/ledger.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { checkProject } from './project-check.js';
import { hostConfig, stateRoot, prepareState } from './runtime.js';
import { initializeBudget } from './usage-budget.js';
import { loadLocalRun, type LocalRun } from './run-record.js';
import { quiescentResources, releaseQuiescentPermits } from './ownership.js';

export async function prepareRun(repo: string, request: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!request.trim() || Buffer.byteLength(request)>60_000) throw new Error('request must contain 1–60000 bytes');
  const checked=await checkProject(repo,signal);const host=await hostConfig();
  const ledger=new GitLedger(host.controlRemote);
  const key=digest(JSON.stringify({host:host.host,repo:checked.repo,request:digest(request),base:checked.base,policy:checked.projectPolicy}));
  await prepareState();const intents=join(stateRoot(),'preparations');await mkdir(intents,{recursive:true,mode:0o700});
  const marker=join(intents,key);let existing=false;
  try{await mkdir(marker,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;existing=true;}
  if(existing){
    let id:string;let intent:{id:string;pid:number;run?:unknown};
    try{intent=JSON.parse((await readBoundedEvidenceFile(join(marker,'intent.json'),16_384)).toString());id=intent.id;}
    catch{throw new Error(`preparation is active or interrupted at ${marker}; inspect before recovery; no second run created`);}
    if(!RUN_ID.test(id))throw new Error('invalid preparation intent');
    const state=await ledger.read();const run=state.runs[id];
    if(!run)throw new Error(`preparation ${id} has uncertain ownership; inspect ${marker}; no second run created`);
    if(['archived','cancelled','escalated'].includes(run.state))throw new Error(`matching request already ended as ${run.state}: ${id}; revise the request for a new run`);
    const local=await loadLocalRun(join(stateRoot(),'runs',id));
    if(run.host!==host.host||local.base!==checked.base||digest(await readFile(local.sourceRequest,'utf8'))!==digest(request))throw new Error('preparation identity differs');
    if(local.generation===0){
      try{process.kill(intent.pid,0);throw new Error(`preparation ${id} is still active; retry after its owner stops`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
      if(run.state!=='requested'||!intent.run||!isDeepStrictEqual(run,intent.run)||!state.owners[id]||state.owners[id]!.host!==host.host||!await quiescentResources(join(stateRoot(),'runs',id)))throw new Error('uncertain preparation differs from its exact requested intent; manual review required');
      local.generation=state.owners[id]!.generation;await atomicJson(join(stateRoot(),'runs',id,'run.json'),local);
      await releaseQuiescentPermits(ledger,join(stateRoot(),'runs',id),local,host.host);
    }
    return {id,state:run.state,reused:true,next:`aegean authorize-pilot --run ${id} --limits FILE`};
  }
  const id=`run-${randomUUID()}`;
  const run=createRun(id,host.host,checked.project.repository,POLICY.version,Date.now(),{approver:checked.project.approver,projectPolicy:checked.projectPolicy});
  await atomicJson(join(marker,'intent.json'),{id,key,pid:process.pid,createdAt:Date.now(),run});
  const dir=join(stateRoot(),'runs',id);await mkdir(dir,{mode:0o700});
  const local:LocalRun={id,repo:checked.repo,worktree:join(dir,'worktree'),generation:0,branch:`aegean/${id}`,base:checked.base,sourceRequest:join(dir,'request.md')};
  await initializeBudget(dir,checked.project.modelExecution!.budget);
  await writeFile(local.sourceRequest,request,{mode:0o600,flag:'wx'});await atomicJson(join(dir,'run.json'),local);
  signal.throwIfAborted();const owned=await ledger.acquire(run);local.generation=owned.owners[id]!.generation;
  await atomicJson(join(dir,'run.json'),local);await releaseQuiescentPermits(ledger,dir,local,host.host);
  return {id,state:'requested',reused:false,next:`aegean authorize-pilot --run ${id} --limits FILE`};
}
