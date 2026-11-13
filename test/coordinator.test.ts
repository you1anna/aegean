import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/coordinator.js';
import { randomUUID } from 'node:crypto';

test('recovery refuses an initializing lock and cancellation retains ownership until verifier cleanup', async () => {
  const f=await fixture();try{
    await f.start();const run=await f.current();const directory=join(f.state,'runs',run.id);const marker=join(directory,'executing');
    await mkdir(marker);const recovery=await f.cli(['recover','--run',run.id,'--confirm-stopped']);assert.notEqual(recovery.code,0);assert.match(recovery.stderr,/owner record missing/);await access(marker);await rm(marker,{recursive:true});
    const candidate=join(f.dir,'candidates','candidate-synthetic');await mkdir(candidate,{recursive:true});
    await writeFile(join(directory,'verifier-resource.json'),JSON.stringify({container:'aegean-'+randomUUID(),candidate}));
    await f.scenario({cleanupFail:true});const blocked=await f.cli(['cancel','--run',run.id]);assert.notEqual(blocked.code,0);assert.match(blocked.stderr,/resources remain/);assert.equal((await f.ledger()).owners[run.id].run,run.id);await access(candidate);
    await f.scenario({});const cancelled=await f.cli(['cancel','--run',run.id]);assert.equal(cancelled.code,0,cancelled.stderr);assert.deepEqual((await f.ledger()).owners,{});await assert.rejects(access(candidate));
  }finally{await f.cleanup();}
});

test('candidate publication requires a separate exact human approval and excludes Builder scratch', async () => {
  const f=await fixture();try {
    await f.start(); await f.scenario({approved:true,builderScratch:true}); const built=await f.resume(); assert.equal(built.code,0,built.stderr);
    const run=await f.current();const local=await f.local();
    assert.equal(await f.realGit(['--git-dir',f.remote,'rev-parse',local.branch]),run.specCommit);
    assert.equal((await f.ledger()).builder,null);assert.deepEqual((await f.ledger()).repositories,{});
    assert.equal((await f.realGit(['ls-tree','-r','--name-only',run.commit!],local.worktree)).includes('.aegean-tmp'),false);
    assert.ok(JSON.parse(built.stdout).approvalCommand.startsWith('/aegean approve-publish '));
    await f.scenario({approved:true,publishApproved:true,publishCommit:'b'.repeat(40)});await f.resume();
    assert.equal(await f.realGit(['--git-dir',f.remote,'rev-parse',local.branch]),run.specCommit);
    await f.scenario({approved:true,publishApproved:true,hangPublication:true});const waiting=f.interactive(['resume','--run',run.id]);
    const deadline=Date.now()+10000;while(!(await f.events()).some(e=>e.effect==='publication-approval-read')){if(Date.now()>deadline)throw new Error('approval read did not start');await new Promise(r=>setTimeout(r,20));}
    waiting.child.kill('SIGINT');const stopped=await waiting.done;assert.equal(stopped.code,130,stopped.stderr);assert.equal(await f.realGit(['--git-dir',f.remote,'rev-parse',local.branch]),run.specCommit);
    await f.scenario({approved:true,publishApproved:true});const published=await f.resume();assert.equal(published.code,0,published.stderr);
    assert.equal(await f.realGit(['--git-dir',f.remote,'rev-parse',local.branch]),run.commit);assert.ok((await f.current()).publicationRef);
  }finally{await f.cleanup();}
});
test('oversized candidate review pauses with diagnostics and never publishes a partial review', async () => {
  const f=await fixture();try {
    const started = await f.start(); assert.equal(started.code, 0, started.stderr);
    await f.scenario({approved:true,publishApproved:true,builderLargeDiff:true});const result=await f.resume();assert.equal(result.code,0,result.stderr);
    const run=await f.current();const local=await f.local();assert.equal(run.state,'paused');assert.equal(run.resumeState,'reviewing',run.reason ?? 'missing pause reason');assert.match(run.reason!,/200000 bytes/);
    assert.equal((await f.events()).filter(e=>e.role==='auditor-review').length,0);
    assert.equal(await f.realGit(['--git-dir',f.remote,'rev-parse',local.branch]),run.specCommit);
    assert.equal((await f.cli(['cancel','--run',run.id])).code,0);assert.deepEqual((await f.ledger()).owners,{});
  }finally{await f.cleanup();}
});

test('spec revisions are committed, published and displayed before a new exact approval', async () => {
  const f = await fixture(); try {
    await writeFile(join(f.repo,'.gitignore'),'design.md\n');await f.realGit(['add','.gitignore']);await f.realGit(['commit','-m','ignore design filenames']);await f.realGit(['push','origin','main']);
    await f.start(); const original = await f.current(); const local = await f.local();
    assert.ok(await f.realGit(['show',`${original.specCommit}:openspec/changes/${original.id}/design.md`],local.worktree));
    const path = join(local.worktree, 'openspec/changes', original.id, 'proposal.md');
    await writeFile(path, (await readFile(path, 'utf8')) + '\nRevised public requirement.\n');
    await f.scenario({ approved: true, approvalSpec: original.spec, approvalCommit: original.specCommit });
    const resumed = await f.resume(); assert.equal(resumed.code, 0, resumed.stderr);
    const revised = await f.current(); assert.equal(revised.state, 'spec-drafted'); assert.notEqual(revised.spec, original.spec);
    assert.notEqual(revised.specCommit, original.specCommit);
    assert.equal(await f.realGit(['--git-dir', f.remote, 'rev-parse', local.branch]), revised.specCommit);
    assert.ok((await readFile(join(f.home, 'pr-body.md'), 'utf8')).includes(`/aegean approve-spec ${revised.spec} ${revised.specCommit}`));
    assert.equal(await f.realGit(['status', '--porcelain'], local.worktree), '');
    assert.equal((await f.events()).filter(e => e.role === 'builder').length, 0);
  } finally { await f.cleanup(); }
});
test('oversized source context is omitted without aborting Scout or losing its checkpoint', async () => {
  const f = await fixture(); try {
    await writeFile(join(f.repo, 'large.js'), 'x'.repeat(70000)); await f.realGit(['add', 'large.js']); await f.realGit(['commit', '-m', 'large context']); await f.realGit(['push', 'origin', 'main']);
    const started = await f.start(); assert.equal(started.code, 0, started.stderr); assert.equal((await f.current()).state, 'spec-drafted');
    assert.equal((await f.events()).filter(e => e.role === 'scout').length, 1);
  } finally { await f.cleanup(); }
});
test('test failures reach Builder as public requirements even when independent review has no findings', async () => {
  const f=await fixture(); try {
    await f.start(); await f.scenario({approved:true,verifierFail:true}); const resumed=await f.resume(); assert.equal(resumed.code,0,resumed.stderr);
    const prompts=(await f.events()).filter(e=>e.role==='builder').map(e=>String(e.prompt));
    assert.equal(prompts.length,3); assert.match(prompts[1]!,/R001: Output/); assert.match(prompts[1]!,/Independent review findings: \[\]/);
    assert.equal((await f.current()).repairs,2); assert.equal((await f.current()).state,'escalated');
  } finally {await f.cleanup();}
});

test('coordinator requires human approval, runs one suite/build, and archives only after human merge', async()=>{
  const f=await fixture(); try {
    const started=await f.start(); assert.equal(started.code,0,started.stderr); assert.equal((await f.current()).state,'spec-drafted');
    assert.deepEqual((await f.events()).filter(e=>e.role).map(e=>e.role),['scout']);
    await f.scenario({approved:true}); const built=await f.resume(); assert.equal(built.code,0,built.stderr); assert.equal((await f.current()).state,'human-merge-review');
    await f.scenario({ approved: true, publishApproved: true });
    const published = await f.resume(); assert.equal(published.code, 0, published.stderr);
    const candidate = await f.current();
    assert.equal(await f.realGit(['--git-dir', f.remote, 'rev-parse', (await f.local()).branch]), candidate.commit);
    await f.merge();
    await f.scenario({ approved: true, merged: true, mergeActor: 'outsider' });
    const rejected = await f.resume(); assert.equal(rejected.code, 0, rejected.stderr);
    assert.equal((await f.current()).state, 'human-merge-review');
    assert.equal((await f.events()).filter(e => e.effect === 'archive').length, 0);
    await f.scenario({approved:true,merged:true}); const archived=await f.resume(); assert.equal(archived.code,0,archived.stderr); assert.equal((await f.current()).state,'archived'); assert.deepEqual((await f.ledger()).owners,{});
    assert.equal((await f.events()).filter(e=>e.role==='auditor-tests').length,1);
  } finally {await f.cleanup();}
});
test('malformed Scout output pauses with charged time instead of losing recovery state',async()=>{
  const f=await fixture();try {
    await f.scenario({malformedRole:'scout'}); await f.start(); const run=await f.current();
    assert.equal(run.state,'paused'); assert.equal(run.resumeState,'requested'); assert.ok(run.activeMs>0);
    await f.scenario({}); const resumed=await f.resume(); assert.equal(resumed.code,0,resumed.stderr); assert.equal((await f.current()).state,'spec-drafted');
  }finally{await f.cleanup();}
});
test('quota failure pauses and explicit resume reuses the immutable protected suite',async()=>{
  const f=await fixture();try {
    await f.start(); await f.scenario({approved:true,quotaRole:'builder'}); await f.resume(); const paused=await f.current();
    assert.equal(paused.state,'paused'); assert.equal(paused.resumeState,'building');
    await f.scenario({approved:true}); const resumed=await f.resume(); assert.equal(resumed.code,0,resumed.stderr); assert.equal((await f.current()).suite,paused.suite); assert.equal((await f.current()).state,'human-merge-review');
    assert.equal((await f.events()).filter(e=>e.role==='auditor-tests').length,1);
  }finally{await f.cleanup();}
});
test('lost suite-push acknowledgement is reconciled without a second Auditor or duplicate commit',async()=>{
  const f=await fixture();try {
    const started = await f.start(); assert.equal(started.code, 0, started.stderr);
    await f.scenario({approved:true,pushAfter:'suite'}); await f.resume();
    await access(join(f.home,'fault-after-suite'));
    if((await f.current()).state!=='human-merge-review') {const resumed=await f.resume();assert.equal(resumed.code,0,resumed.stderr);}
    assert.equal((await f.current()).state,'human-merge-review'); assert.equal((await f.events()).filter(e=>e.role==='auditor-tests').length,1);
  }finally{await f.cleanup();}
});
test('approved specification and verified candidate must remain exact before publication',async()=>{
  const f=await fixture();try {
    await f.start(); await f.scenario({approved:true}); await f.resume(); const local=await f.local();
    const before=(await f.events()).filter(e=>e.effect==='push'&&e.kind==='candidate').length;
    await writeFile(join(local.worktree,'app.cjs'),'console.log("unreviewed");\n'); await f.realGit(['add','app.cjs'],local.worktree); await f.realGit(['commit','-m','unreviewed'],local.worktree);
    const result=await f.resume(); assert.notEqual(result.code,0); assert.equal((await f.events()).filter(e=>e.effect==='push'&&e.kind==='candidate').length,before);
  }finally{await f.cleanup();}
});
test('post-approval configuration drift is rejected before any further model call',async()=>{
  const f=await fixture();try {
    await f.start(); await f.scenario({approved:true,quotaRole:'builder'}); await f.resume(); const local=await f.local();
    await writeFile(join(local.worktree,'aegean.json'),(await readFile(join(local.worktree,'aegean.json'),'utf8'))+' ');
    const count=(await f.events()).filter(e=>e.role).length; await f.scenario({approved:true}); const result=await f.resume();
    assert.notEqual(result.code,0); assert.equal((await f.events()).filter(e=>e.role).length,count);
  }finally{await f.cleanup();}
});
test('partial archive output is never committed as a completed archive on resume',async()=>{
  const f=await fixture();try {
    await f.start(); await f.scenario({approved:true,publishApproved:true}); await f.resume(); await f.merge();
    const before=await f.realGit(['--git-dir',f.remote,'rev-parse','main']);
    await f.scenario({approved:true,merged:true,archivePartial:true}); assert.notEqual((await f.resume()).code,0);
    const second=await f.resume(); assert.notEqual(second.code,0); assert.equal(await f.realGit(['--git-dir',f.remote,'rev-parse','main']),before); assert.equal((await f.current()).state,'merged');
  }finally{await f.cleanup();}
});
test('interrupted Builder stops, preserves approval/suite and releases execution permits',async()=>{
  const f=await fixture();let running:ReturnType<typeof f.interactive>|undefined;try {
    await f.start(); await f.scenario({approved:true,hangRole:'builder'});
    const id=(await f.current()).id; running=f.interactive(['resume','--run',id]);
    let exited:Awaited<typeof running.done>|undefined;void running.done.then(result=>{exited=result;});
    // Reaching Builder includes approval, artifact validation and suite staging;
    // allow that real setup within the fixture's 40-second process budget.
    const limit=Date.now()+30000; while(!(await f.events()).some(e=>e.role==='builder')) {if(exited)throw new Error(`fixture exited before Builder: ${exited.stderr}`);if(Date.now()>limit)throw new Error('fixture did not reach Builder within 30 seconds');await new Promise(r=>setTimeout(r,20));}
    const cancelled=await f.cli(['cancel','--run',id]); assert.notEqual(cancelled.code,0);
    const recover=await f.cli(['recover','--run',id,'--confirm-stopped']); assert.notEqual(recover.code,0); assert.match(recover.stderr,/still alive/);
    running.child.kill('SIGINT');const interrupted=await running.done;assert.equal(interrupted.code,130,interrupted.stderr);
    const paused=await f.current(); assert.equal(paused.state,'paused'); assert.ok(paused.approvalRef&&paused.suite); assert.equal((await f.ledger()).owners[id].run,id);
    await assert.rejects(access(join(f.state,'runs',id,'executing')));
    assert.equal((await f.ledger()).builder,null);assert.deepEqual((await f.ledger()).repositories,{});
    const stopped=await f.cli(['cancel','--run',id]);assert.equal(stopped.code,0,stopped.stderr);assert.deepEqual((await f.ledger()).owners,{});
  }finally{if(running){running.child.kill('SIGINT');await running.done;}await f.cleanup();}
});
