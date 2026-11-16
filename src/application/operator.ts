import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { authentication, subscriptionEnvironment, assertVersion } from '../adapters/agents.js';
import { interactiveProcess } from '../adapters/interactive-process.js';
import { checked, command } from '../adapters/process.js';
import { hostActivities, reserveHost, recoverHostActivities } from '../adapters/host-activity.js';
import { GitLedger } from '../adapters/ledger.js';
import { quiescentResources } from './ownership.js';
import { binaries, hostConfig, stateRoot } from './runtime.js';
import { verifierStartArgs, verifierProfileState } from '../domain/verifier-plan.js';
import toolchain from '../../toolchain.json' with {type:'json'};
export async function releaseInfo(root:string){
  const manifest=JSON.parse(await readFile(join(root,'installation.json'),'utf8'));
  return {release:root,sourceCommit:manifest.sourceCommit,sourceHash:manifest.sourceHash,artifactHash:manifest.artifactHash,node:manifest.node,toolVersions:await readFile(join(root,'tool-versions.json'),'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;}),hostConfig:join(stateRoot(),'settings.json'),operations:join(root,'docs/OPERATIONS.md')};
}
export async function authCommand(root:string,action:string,provider:string|undefined,signal:AbortSignal){
  const bins=binaries(root);
  if(action==='status'&&!provider)return authentication(bins.codex,bins.claude);
  if(action!=='login'||!['claude','codex'].includes(provider??''))throw new Error('Usage: aegean auth status | auth login claude|codex');
  const binary=provider==='claude'?bins.claude:bins.codex;await assertVersion(binary,toolchain[provider as 'claude'|'codex']);
  await interactiveProcess(binary,provider==='claude'?['auth','login']:['login'],subscriptionEnvironment(process.env),signal);
  return authentication(bins.codex,bins.claude);
}
export async function assertHostQuiescent(){
  const host=await hostConfig();const control=new GitLedger(host.controlRemote);
  try {
    const ledger=await control.read();
    if(Object.values(ledger.repositories).some(p=>p.host===host.host)||ledger.builder?.host===host.host)throw new Error('host owns execution permits; inspect aegean status before verifier stop');
  } catch(error) {
    if(!(error instanceof Error)||!error.message.startsWith('legacy control ledger requires explicit quiescent migration'))throw error;
    // Read-only legacy validation requires no owner and every run terminal.
    // Uninstall/provisioning must not implicitly migrate the control remote.
    if((await control.inspectMigration()).schemaVersion!==1)throw new Error('control schema changed during host inspection; retry');
  }
  let dirs:string[]=[];try{dirs=await readdir(join(stateRoot(),'runs'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const id of dirs){
    const dir=join(stateRoot(),'runs',id);
    if(!/^run-[a-f0-9-]{36}$/.test(id))throw new Error('unknown run record; inspect before host transition');
    try{await lstat(join(dir,'executing'));throw new Error(`run ${id} retains an execution lock; recover before host transition`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(!await quiescentResources(dir))throw new Error(`run ${id} retains uncertain resources; recover before host transition`);
  }
}
export async function verifierCommand(action:string,signal:AbortSignal,confirmed=false){
  const v=toolchain.verifier;
  if(action==='recover')return recoverHostActivities(stateRoot(),confirmed);
  if(!['status','start','stop'].includes(action))throw new Error('Usage: aegean verifier status|start|stop|recover --confirm-stopped');
  const args=['--profile',v.profile];
  if(action==='status'){
    const result=await command('colima',['status',...args],{signal});
    return {profile:v.profile,available:result.code===0,detail:result.stdout||result.stderr,activities:await hostActivities(stateRoot())};
  }
  const release=await reserveHost(stateRoot(),'transition',`verifier-${action}`);let completed=false;let mutating=false;
  try{
    await assertVersion('colima',v.colima);await assertVersion('docker',v.dockerClient);
    await assertHostQuiescent();
    const profile=join(homedir(),'.colima',v.profile,'colima.yaml');
    const config=await readFile(profile,'utf8').catch(()=>{throw new Error('verifier profile missing; use the reviewed scripts/bootstrap.sh installer');});
    if(!/^autoActivate: false$/m.test(config))throw new Error('verifier profile can change Docker context; review provisioning before start');
    if(action==='start'){
      mutating=true;await checked('colima',verifierStartArgs(v),{signal,timeoutMs:180_000});
      await checked('docker',['--context',`colima-${v.profile}`,'image','inspect',v.image],{signal});
    }else{
      const listing=await checked('colima',['list','--json'],{signal});
      if(verifierProfileState(listing,v.profile)==='Running'){
        const containers=await checked('docker',['--context',`colima-${v.profile}`,'ps','-aq'],{signal});
        if(containers)throw new Error('verifier has retained containers; inspect receipts and recover before stop');
        mutating=true;await checked('colima',['stop',...args],{signal,timeoutMs:120_000});
      }
    }
    completed=true;return {profile:v.profile,action,completed:true};
  }finally{if(completed||!mutating)await release();}
}
