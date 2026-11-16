import { pathToFileURL } from 'node:url';
import { ModelPolicySchema, qualificationIdentity, qualificationPolicyIdentity } from '../../src/domain/model-policy.js';
import { mkdtemp, mkdir, cp, writeFile, readFile, symlink, rm, readdir, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { checked, command, type Result } from '../../src/adapters/process.js';
import type { Run } from '../../src/domain/workflow.js';
import { syntheticAcceptance } from './acceptance.js';

export async function fixture(options: { approvalMode?: 'local' | 'github-comments'; prerequisitesOnly?: boolean; qualifiedBuilder?: boolean } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'aegean-coordinator-test-')));
  const home = join(dir, 'home'); const root = join(dir, 'release'); const repo = join(dir, 'project'); const verifier = join(dir, 'verifier');
  const control = join(dir, 'control.git'); const remote = join(dir, 'project.git'); const bin = join(home, 'bin');
  for (const p of [home, root, repo, verifier, bin, join(root,'bin'), join(root,'tools/node_modules/.bin'), join(home,'.local/state/aegean')]) await mkdir(p,{recursive:true});
  const git = await checked('/usr/bin/which', ['git']);
  const env = { PATH:bin + ':' + process.env.PATH, HOME:home, TMPDIR:dir, GIT_CONFIG_NOSYSTEM:'1', LANG:'en_US.UTF-8' };
  await writeFile(join(home,'.gitconfig'), `[user]\n name = Fixture\n email = fixture@localhost\n[url "${control}"]\n insteadOf = git@github.com:fixture/verifier.git\n[url "${remote}"]\n insteadOf = git@github.com:fixture/project.git\n`);
  await writeFile(join(home,'fixture.json'), JSON.stringify({git,control,verifier,remote}));
  await writeFile(join(home,'scenario.json'), '{}');
  await cp('dist/src',join(root,'dist/src'),{recursive:true}); await cp('dist/scripts',join(root,'dist/scripts'),{recursive:true}); await cp('package.json',join(root,'package.json'));
  await cp('package.json',join(root,'dist/package.json'));
  await mkdir(join(root,'node_modules')); await cp(resolve('node_modules/zod'),join(root,'node_modules/zod'),{recursive:true});
  const pins=JSON.parse(await readFile('toolchain.json','utf8')); pins.verifier.candidateRoot=join(dir,'candidates');
  if (options.qualifiedBuilder) {
    const policy = ModelPolicySchema.parse(pins.models); const role = policy.roles.builder;
    role.candidate = { provider: 'codex', model: 'gpt-6-luna', effort: 'medium' };
    role.qualification = { taskClass: 'routine-cli', identity: qualificationIdentity(role, pins.codex, qualificationPolicyIdentity(policy, pins)), manifest: 'a'.repeat(64),
      pairs: Array.from({ length: 30 }, (_, n) => ({ fixture: `synthetic-${Math.floor(n / 3)}`, attempt: n % 3 + 1,
        baseline: { tokens: 100, passed: true, missedRequirements: 0, acceptedDefects: 0 }, candidate: { tokens: 70, passed: true, missedRequirements: 0, acceptedDefects: 0 } })) };
    pins.models = policy;
  }
  for(const file of ['toolchain.json','dist/toolchain.json']) await writeFile(join(root,file),JSON.stringify(pins));
  const fake=resolve('test/fixtures/fake-cli.cjs');
  await mkdir(join(bin, 'faults'));
  await mkdir(join(bin, 'real'));
  await symlink(fake, join(bin, 'faults/git'));
  await symlink(git, join(bin, 'real/git'));
  await cp('test/fixtures/git-shim.sh', join(bin, 'git'));
  await chmod(join(bin, 'git'), 0o755);
  for(const tool of ['gh','docker']) await symlink(fake,join(bin,tool));
  await cp(fake,join(root,'bin/claude'));
  await writeFile(join(root,'bin/package.json'),JSON.stringify({type:'commonjs'}));
  for(const tool of ['codex','openspec']) await cp(fake,join(root,'tools/node_modules/.bin',tool));
  const state=join(home,'.local/state/aegean');
  const host=randomUUID();
  await writeFile(join(state,'settings.json'),JSON.stringify({schemaVersion:1,host,controlRemote:'git@github.com:fixture/verifier.git',verifierCheckout:verifier,excludedRoots:[join(home,'excluded')],billingConfirmed:true}));
  // Use the fixture release's real validators when its policy differs; never relax identity checks.
  const adapters = options.qualifiedBuilder ? await import(pathToFileURL(join(root, 'dist/src/adapters/acceptance-evidence.js')).href) : undefined;
  await syntheticAcceptance(root,state,host, options.prerequisitesOnly ? ['builder-isolation', 'protected-verifier'] : undefined, adapters);
  if (options.prerequisitesOnly) await rm(join(state, 'acceptance.json'));
  const realGit=(args:string[],cwd=repo)=>checked(git,args,{cwd,env});
  for(const p of [repo,verifier]) await realGit(['init','-b','main'],p);
  const project={schemaVersion:2,standardVersion:pins.policy,repository:'fixture/project',approver:{id:1,login:'fixture'},approvalMode:options.approvalMode ?? 'github-comments',modelExecution:{budget:{enforcement:'monitored',maxTokensPerRun:10000,maxTokensPerCall:1000},task:{class:'unknown',paths:[],dependencies:[],concerns:[]}},checks:[['node','--check','app.cjs']],verifier:{kind:'cli',image:pins.verifier.image,command:['node','app.cjs']}};
  await writeFile(join(repo,'aegean.json'),JSON.stringify(project)); await writeFile(join(repo,'app.cjs'),'console.log("broken");\n');
  await realGit(['add','.']); await realGit(['commit','-m','seed']); await realGit(['clone','--bare',repo,remote]); await realGit(['remote','add','origin','git@github.com:fixture/project.git']); await realGit(['fetch','origin']);
  await writeFile(join(verifier,'README.md'),'Private synthetic verifier\n'); await realGit(['add','.'],verifier); await realGit(['commit','-m','seed'],verifier);
  await realGit(['checkout','--orphan','control'],verifier); await realGit(['rm','-rf','.'],verifier);
  await writeFile(join(verifier,'control.json'),JSON.stringify({schemaVersion:2,revision:0,owners:{},repositories:{},builder:null,runs:{}}));
  await realGit(['add','.'],verifier); await realGit(['commit','-m','control'],verifier); await realGit(['checkout','main'],verifier);
  await realGit(['clone','--bare',verifier,control]); await realGit(['remote','add','origin','git@github.com:fixture/verifier.git'],verifier); await realGit(['fetch','origin'],verifier);
  const request=join(dir,'request.md'); await writeFile(request,'Make the synthetic CLI output ok.');
  const cli=(args:string[],signal?:AbortSignal):Promise<Result> => command(process.execPath,[join(root,'dist/src/cli.js'),...args],{cwd:repo,env,timeoutMs:120000,...(signal?{signal}: {})});
  const interactive=(args:string[])=>{
    const child=spawn(process.execPath,[join(root,'dist/src/cli.js'),...args],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
    const done=new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});}));
    return {child,done};
  };
  const scenario=async(value:Record<string,unknown>)=>writeFile(join(home,'scenario.json'),JSON.stringify(value));
  const ledger=async()=>JSON.parse(await realGit(['--git-dir',control,'show','control:control.json']));
  const current=async():Promise<Run>=>Object.values((await ledger()).runs).at(-1) as Run;
  const local=async()=>JSON.parse(await readFile(join(state,'runs',(await current()).id,'run.json'),'utf8'));
  const events=async():Promise<Record<string,unknown>[]>=>{try{return (await readFile(join(home,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));}catch{return [];}};
  const start=()=>cli(['start','--request',request]);
  const resume=async(signal?:AbortSignal)=>cli(['resume','--run',(await current()).id],signal);
  const cleanup=()=>rm(dir,{recursive:true,force:true});
  const merge=async()=>realGit(['--git-dir',remote,'update-ref','refs/heads/main',(await current()).commit!]);
  return {dir,home,root,repo,verifier,state,remote,control,env,git,realGit,cli,interactive,scenario,ledger,current,local,events,start,resume,cleanup,merge,runDirs:()=>readdir(join(state,'runs'))};
}
