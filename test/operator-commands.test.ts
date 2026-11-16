import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,stat,symlink,mkdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parsePilotLimits} from '../src/domain/pilot-limits.js';
import {validateArguments} from '../src/application/cli-arguments.js';
import {reserveHost,recoverHostActivities,hostActivities} from '../src/adapters/host-activity.js';
import {OperatorLog} from '../src/adapters/operator-log.js';
import {fixture} from './helpers/coordinator.js';
const limits={schemaVersion:1,expiresInMinutes:120,maxModelCalls:12,activeMinutes:60,maxRepairs:2,maxRevisions:2};
test('limits enforce shared bounds and reject malformed input',()=>{
  const parsed=parsePilotLimits(limits,1000);assert.equal(parsed.expiresAt,7201000);assert.equal(parsed.budget.activeTimeoutMs,3600000);assert.match(parsed.limitsDigest,/^[a-f0-9]{64}$/);
  for(const extra of [{schemaVersion:2},{expiresInMinutes:1441},{activeMinutes:61},{activeMinutes:NaN},{maxModelCalls:1.5},{maxRepairs:3},{secret:'no'}])assert.throws(()=>parsePilotLimits({...limits,...extra}));
});
test('CLI rejects duplicate, unknown and mixed options before effects',()=>{
  for(const args of [['prepare','--request','a','--request','b'],['authorize-pilot','--limits','a','--active-minutes','1'],['verifier','start','--force'],['info','--oops'],['resume','extra']])assert.throws(()=>validateArguments(args));
  assert.match(validateArguments(['prepare','--help'])!,/--request/);assert.equal(validateArguments(['doctor','--require','prerequisites']),undefined);
});
test('host transition excludes execution and retained activity requires explicit recovery',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aegean-host-'));
  try{
    const release=await reserveHost(dir,'execution','fixture');await assert.rejects(reserveHost(dir,'transition','stop'),/blocked/);await assert.rejects(recoverHostActivities(dir,true),/still running/);await release();
    const stop=await reserveHost(dir,'transition','stop');await assert.rejects(reserveHost(dir,'execution','resume'),/blocked/);await stop();assert.deepEqual(await hostActivities(dir),[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('operator logs are private, bounded, exclude arbitrary fields and reject symlinks',async()=>{
  const dir=await realpath(await mkdtemp(join(tmpdir(),'aegean-log-')));
  try{
    const log=new OperatorLog(join(dir,'logs'));log.event('begin',{command:'prepare'});assert.throws(()=>log.event('stage',{role:'secret\nvalue'}),/unsafe/);
    log.append('x'.repeat(21*1024*1024));log.close();assert.throws(()=>log.check(),/unavailable/);
    const paths=(await readdir(join(dir,'logs'))).map(n=>join(dir,'logs',n));assert.equal(paths.length,4);
    const sizes=await Promise.all(paths.map(p=>stat(p)));assert.ok(sizes.reduce((sum,s)=>sum+s.size,0)<=20*1024*1024);assert.ok(sizes.every(s=>(s.mode&0o077)===0));
    await symlink(join(dir,'logs'),join(dir,'alias'));assert.throws(()=>new OperatorLog(join(dir,'alias')),/unsafe|symlink/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing model budget fails before allocation and leaves no run or ledger write',async()=>{
  const f=await fixture();try{
    const path=join(f.repo,'aegean.json');const config=JSON.parse(await readFile(path,'utf8'));delete config.modelExecution;await writeFile(path,JSON.stringify(config));
    await f.realGit(['add','.']);await f.realGit(['commit','-m','missing budget']);await f.realGit(['push','origin','main']);
    const before=await f.ledger();const result=await f.start();assert.notEqual(result.code,0);assert.match(result.stderr,/modelExecution/);
    const dirs=await f.runDirs().catch(()=>[]);assert.deepEqual(dirs,[]);assert.deepEqual(await f.ledger(),before);assert.equal((await f.events()).filter(e=>e.role).length,0);
  }finally{await f.cleanup();}
});
test('prepare is repeatable, frees execution capacity and never calls models',async()=>{
  const f=await fixture({prerequisitesOnly:true,approvalMode:'local'});try{
    const args=['prepare','--request',join(f.dir,'request.md')];const first=await f.cli(args);assert.equal(first.code,0,first.stderr);const id=JSON.parse(first.stdout).id;
    const second=await f.cli(args);assert.equal(second.code,0,second.stderr);assert.equal(JSON.parse(second.stdout).id,id);assert.equal(JSON.parse(second.stdout).reused,true);
    assert.equal((await f.runDirs()).length,1);assert.equal((await f.events()).filter(e=>e.role).length,0);assert.deepEqual((await f.ledger()).repositories,{});
    const prerequisites=await f.cli(['doctor','--require','prerequisites']);assert.equal(prerequisites.code,0,prerequisites.stderr);
    const full=await f.cli(['doctor','--require','full']);assert.equal(full.code,1);assert.equal(JSON.parse(full.stdout).fullWorkflowReady,false);
  }finally{await f.cleanup();}
});
test('concurrent preparation cannot allocate duplicate runs',async()=>{
  const f=await fixture({prerequisitesOnly:true});try{
    const args=['prepare','--request',join(f.dir,'request.md')];const results=await Promise.all([f.cli(args),f.cli(args)]);
    assert.ok(results.some(r=>r.code===0),results.map(r=>r.stderr).join('\n'));assert.equal(Object.keys((await f.ledger()).runs).length,1);assert.equal((await f.runDirs()).length,1);
  }finally{await f.cleanup();}
});
test('unavailable private log rejects before run allocation',async()=>{
  const f=await fixture();try{
    await mkdir(join(f.home,'Library/Logs'),{recursive:true});await symlink(f.repo,join(f.home,'Library/Logs/aegean'));
    const result=await f.cli(['prepare','--request',join(f.dir,'request.md')]);assert.notEqual(result.code,0);assert.match(result.stderr,/unsafe|symlink/);assert.deepEqual((await f.ledger()).runs,{});
  }finally{await f.cleanup();}
});
test('prepare reconciles an exact acquired run after lost local generation confirmation',async()=>{
  const f=await fixture({prerequisitesOnly:true});try{
    const args=['prepare','--request',join(f.dir,'request.md')];const first=await f.cli(args);assert.equal(first.code,0,first.stderr);
    const local=await f.local();local.generation=0;await writeFile(join(f.state,'runs',local.id,'run.json'),JSON.stringify(local));
    const second=await f.cli(args);assert.equal(second.code,0,second.stderr);assert.equal(JSON.parse(second.stdout).id,local.id);
    assert.ok((await f.local()).generation>0);assert.equal(Object.keys((await f.ledger()).runs).length,1);
  }finally{await f.cleanup();}
});
test('host lifecycle preserves context and retains uncertain transition until explicit recovery',async()=>{
  const f=await fixture();try{
    await mkdir(join(f.home,'.colima/aegean'),{recursive:true});await writeFile(join(f.home,'.colima/aegean/colima.yaml'),'autoActivate: false\n');
    const fake=`#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');const name=path.basename(process.argv[1]),args=process.argv.slice(2),home=process.env.HOME; if(args.includes('--version')){console.log(name==='colima'?'colima version 0.10.3':'Docker version 29.9.1');process.exit(0);}fs.appendFileSync(path.join(home,'host-calls'),JSON.stringify({name,args})+'\\n');if(name==='colima'&&args[0]==='start'&&fs.existsSync(path.join(home,'fail-start')))process.exit(1);`;
    await rm(join(f.home,'bin/docker'));for(const name of ['colima','docker'])await writeFile(join(f.home,'bin',name),fake,{mode:0o755});
    const started=await f.cli(['verifier','start']);assert.equal(started.code,0,started.stderr);assert.equal((await f.cli(['verifier','start'])).code,0);
    const calls=await readFile(join(f.home,'host-calls'),'utf8');assert.match(calls,/--activate=false/);assert.doesNotMatch(calls,/"use"|"pull"/);
    await writeFile(join(f.home,'fail-start'),'fail');const failed=await f.cli(['verifier','start']);assert.notEqual(failed.code,0);
    assert.equal((await hostActivities(f.state)).length,1);
    const blocked=await f.cli(['prepare','--request',join(f.dir,'request.md')]);assert.notEqual(blocked.code,0);assert.match(blocked.stderr,/blocked/);
    const recovered=await f.cli(['verifier','recover','--confirm-stopped']);assert.equal(recovered.code,0,recovered.stderr);assert.equal((await hostActivities(f.state)).length,0);
  }finally{await f.cleanup();}
});
test('shipped project and limit examples validate against their owners',async()=>{
  const {ProjectSchema}=await import('../src/domain/config.js');
  const config=ProjectSchema.parse(JSON.parse(await readFile('examples/aegean.json','utf8')));assert.equal(config.modelExecution?.budget.enforcement,'monitored');
  assert.ok(parsePilotLimits(JSON.parse(await readFile('examples/pilot-limits.json','utf8'))).budget.maxModelCalls>0);
});
test('a project keeps its reviewed standard across a compatible policy change; other versions fail closed',async()=>{
  const {ProjectSchema,acceptsStandard}=await import('../src/domain/config.js');
  const toolchain=JSON.parse(await readFile('toolchain.json','utf8'));
  const example=JSON.parse(await readFile('examples/aegean.json','utf8'));
  for(const version of [toolchain.minProjectStandard,toolchain.policy])assert.equal(ProjectSchema.parse({...example,standardVersion:version}).standardVersion,version);
  assert.equal(acceptsStandard('0.4.0','0.4.0','0.5.0'),true);assert.equal(acceptsStandard('0.5.0','0.4.0','0.5.0'),true);assert.equal(acceptsStandard('0.4.9','0.4.0','0.5.0'),true);
  for(const version of ['0.3.9','0.5.1','0.10.0','1.0.0','0.4','0.4.0-rc1','v0.4.0','',' 0.4.0','00.4.0'])assert.equal(acceptsStandard(version,'0.4.0','0.5.0'),false,version);
  assert.equal(acceptsStandard('0.10.0','0.9.0','0.10.0'),true); // numeric order, not text order
  assert.throws(()=>ProjectSchema.parse({...example,standardVersion:'0.3.0'}),/accepts project standards/);
  assert.throws(()=>ProjectSchema.parse({...example,standardVersion:'99.0.0'}),/accepts project standards/);
});
test('newline-terminated reviewed project policy survives start and frozen-policy checks',async()=>{
  const f=await fixture({approvalMode:'local'});try{
    const path=join(f.repo,'aegean.json');await writeFile(path,(await readFile(path,'utf8'))+'\n');await f.realGit(['add','.']);await f.realGit(['commit','-m','formatted config']);await f.realGit(['push','origin','main']);
    const result=await f.start();assert.equal(result.code,0,result.stderr);assert.equal((await f.current()).state,'spec-drafted');
  }finally{await f.cleanup();}
});
test('verifier state parser does not equate errors or absent profiles with stopped',async()=>{
  const {verifierProfileState}=await import('../src/domain/verifier-plan.js');
  assert.equal(verifierProfileState('{"name":"aegean","status":"Stopped"}','aegean'),'Stopped');
  for(const text of ['', '{}','{"name":"aegean","status":"Broken"}','not-json'])assert.throws(()=>verifierProfileState(text,'aegean'));
});
test('host quiescence can inspect legacy terminal history without migration and rejects legacy owners',async()=>{
  const f=await fixture();try{
    await f.realGit(['checkout','control'],f.verifier);
    const file=join(f.verifier,'control.json');const legacy={schemaVersion:1,revision:0,owner:null,runs:{}};
    await writeFile(file,JSON.stringify(legacy));await f.realGit(['add','.'],f.verifier);await f.realGit(['commit','-m','legacy empty'],f.verifier);await f.realGit(['push','origin','control'],f.verifier);
    const {command}=await import('../src/adapters/process.js');const {pathToFileURL}=await import('node:url');
    const script=`import {assertHostQuiescent} from ${JSON.stringify(pathToFileURL(join(f.root,'dist/src/application/operator.js')).href)};await assertHostQuiescent();`;
    const before=await f.realGit(['--git-dir',f.control,'rev-parse','control']);
    const result=await command(process.execPath,['--input-type=module','-e',script],{env:f.env,cwd:f.repo});assert.equal(result.code,0,result.stderr);
    assert.equal(await f.realGit(['--git-dir',f.control,'rev-parse','control']),before);
    await writeFile(file,JSON.stringify({...legacy,owner:{run:'legacy',host:'old-host',generation:1}}));await f.realGit(['add','.'],f.verifier);await f.realGit(['commit','-m','legacy owner'],f.verifier);await f.realGit(['push','origin','control'],f.verifier);
    const active=await command(process.execPath,['--input-type=module','-e',script],{env:f.env,cwd:f.repo});assert.notEqual(active.code,0);assert.match(active.stderr,/quiescent/);
  }finally{await f.cleanup();}
});
