import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, access, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { checked, type Result, type Options } from '../src/adapters/process.js';
import { verify, cleanupRetained, exportCommit } from '../src/adapters/verifier.js';
import { repairFeedback } from '../src/domain/feedback.js';
import { ProjectSchema, SuiteSchema } from '../src/domain/config.js';
import toolchain from '../toolchain.json' with { type: 'json' };

test('verifier separates candidate rejection/limits, cancellation and infrastructure, and cleans resources', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'aegean-verifier-test-'));
  const git = (args: string[]) => checked('git', args, { cwd: repo });
  const project = ProjectSchema.parse({ schemaVersion:1, standardVersion:'0.1.0', repository:'fixture/project', checks:[['node','app.js']], verifier:{kind:'cli', image:toolchain.verifier.image, command:['node','app.js']} });
  const suite = SuiteSchema.parse({schemaVersion:2,spec:'a'.repeat(64),cases:[{input:'hidden-input',stdout:'hidden-expected',exit:0,requirement:'R001'}]});
  const result = (fields: Partial<Result> = {}): Result => ({code:0,stdout:'hidden-expected',stderr:'',durationMs:1,interrupted:false,...fields});
  let mode = 'pass'; let removed = 0;
  const execute = async (_file: string, args: readonly string[], _options?: Options): Promise<Result> => {
    if (args.includes('rm')) { removed++; return result({code:mode === 'cleanup' ? 1 : 0}); }
    if (args.includes('image')) return result({code:mode === 'image' ? 1 : 0});
    if (args.includes('inspect')) return result({stdout:JSON.stringify({Status:mode === 'daemon' || mode === 'daemon-timeout' ? 'created' : mode === 'timeout' ? 'running' : 'exited',Running:mode==='timeout',StartedAt:mode==='daemon-timeout'?'0001-01-01T00:00:00Z':new Date(Date.now()-20000).toISOString(),ExitCode:125,Error:''})});
    if (mode === 'timeout' || mode === 'output-limit' || mode === 'aborted' || mode === 'daemon-timeout') return result({code:128,interrupted:true,termination:mode==='daemon-timeout'?'timeout':mode});
    if (mode === 'daemon' || mode === 'exit125') return result({code:125});
    return result({stdout:mode === 'fail' ? 'hidden-actual' : 'hidden-expected'});
  };
  try {
    await git(['init','-b','main']); await writeFile(join(repo,'app.js'),'console.log("ok")'); await git(['add','.']);
    await git(['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','seed']); const commit=await git(['rev-parse','HEAD']);
    const controller=new AbortController();
    const cancelled=await verify(repo,commit,project,suite,controller.signal,async(_file,args,options)=>{
      assert.ok(args.includes('image'),'cancelled preflight must not reach container execution');
      assert.equal(options?.signal,controller.signal);controller.abort();return result();
    });
    assert.equal(cancelled.outcome,'cancelled');assert.equal(cancelled.reason,'operator-cancelled');
    for (const [scenario,outcome,reason] of [['pass','pass','passed'],['fail','fail','protected-requirement-failed'],['timeout','fail','candidate-timeout'],['daemon-timeout','inconclusive','execution-unknown'],['output-limit','fail','candidate-output-limit'],['aborted','cancelled','operator-cancelled'],['image','inconclusive','image-unavailable'],['daemon','inconclusive','container-infrastructure'],['exit125','fail','protected-requirement-failed']]) {
      mode=scenario!; const receipt=await verify(repo,commit,project,suite,undefined,execute);
      assert.equal(receipt.outcome,outcome,mode); assert.equal(receipt.reason,reason,mode);
      assert.doesNotMatch(JSON.stringify(receipt),/hidden-(input|expected|actual)/);
    }
    assert.ok(removed>0);
    await symlink('/outside-synthetic',join(repo,'unsafe')); await git(['add','.']); await git(['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','symlink']);
    mode='pass'; const rejected=await verify(repo,await git(['rev-parse','HEAD']),project,suite,undefined,execute);
    assert.equal(rejected.outcome,'fail'); assert.equal(rejected.reason,'candidate-rejected');
    mode='cleanup'; const cleanup=await verify(repo,commit,project,suite,undefined,execute);
    assert.equal(cleanup.outcome,'inconclusive'); assert.equal(cleanup.reason,'container-cleanup-failed');
    await access(cleanup.retainedResources!.candidate); assert.equal(await cleanupRetained(cleanup,execute),false);
    mode='pass'; assert.equal(await cleanupRetained(cleanup,execute),true); await assert.rejects(access(cleanup.retainedResources!.candidate));
    assert.throws(()=>SuiteSchema.parse({...suite,cases:[{...suite.cases[0],feedback:'hidden-expected'}]}));
    assert.deepEqual(repairFeedback('protected-requirement-failed',['R001','hidden-expected'],'### Requirement: Public output\n'),['Protected acceptance found a public requirement violation.','R001: Public output']);
  } finally {await rm(repo,{recursive:true,force:true});}
});

test('candidate export stops when cancelled during blob preparation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aegean-export-cancel-'));const repo=join(root,'repo');const target=join(root,'export');
  await mkdir(repo);await mkdir(target);const controller=new AbortController();let stopPolling=false;let polling:Promise<void>|undefined;
  const git=(args:string[])=>checked('git',args,{cwd:repo});
  try{
    await git(['init','-b','main']);
    for(let i=0;i<100;i++)await writeFile(join(repo,`file-${i}.txt`),String(i));
    await git(['add','.']);await git(['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','seed']);
    const commit=await git(['rev-parse','HEAD']);
    polling=(async()=>{while(!stopPolling){if((await readdir(target)).length){controller.abort();return;}await new Promise(resolve=>setTimeout(resolve,2));}})();
    await assert.rejects(exportCommit(repo,commit,target,controller.signal));
    assert.ok((await readdir(target)).length<100,'cancellation must stop before exporting the entire candidate');
  }finally{stopPolling=true;await polling;await rm(root,{recursive:true,force:true});}
});
