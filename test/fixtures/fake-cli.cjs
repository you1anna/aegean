#!/usr/bin/env node
// Synthetic integration boundary only. Never points at operator state/remotes.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const home = process.env.HOME;
const config = JSON.parse(fs.readFileSync(path.join(home, 'fixture.json')));
const scenario = JSON.parse(fs.readFileSync(path.join(home, 'scenario.json')));
const tool = path.basename(process.argv[1]); const args = process.argv.slice(2);
const log = event => fs.appendFileSync(path.join(home, 'events.jsonl'), JSON.stringify(event) + '\n');
const output = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
const git = (a, cwd) => cp.execFileSync(config.git, a, { cwd, encoding: 'utf8' }).trim();
const state = () => JSON.parse(git(['--git-dir', config.control, 'show', 'control:control.json']));
const run = () => Object.values(state().runs).at(-1);
const once = key => { const file = path.join(home, 'fault-' + key); if (fs.existsSync(file)) return false; fs.writeFileSync(file, 'used'); return true; };
function fail(text) { process.stderr.write(text); process.exit(1); }
if (tool === 'git') {
  if (scenario.builderCheckpointAfter && args.includes('add') && args.includes('-A')) {
    const current = run();
    const effects = path.join(home,'.local/state/aegean/runs',current.id,'effects');
    const complete = fs.existsSync(effects) && fs.readdirSync(effects).some(name => name.startsWith('builder-') && JSON.parse(fs.readFileSync(path.join(effects,name))).status === 'completed');
    if (current.state === 'building' && complete && once('builder-checkpoint')) fail('synthetic candidate checkpoint interrupted');
  }

  if (args.includes('get-url') && args.at(-1) === 'origin') {
    const push = args.includes('--push') ? cp.spawnSync(config.git, ['config', '--get-all', 'remote.origin.pushurl'], {cwd:process.cwd(),encoding:'utf8'}) : undefined;
    output(push?.status === 0 ? push.stdout.trim() : git(['config', '--get-all', 'remote.origin.url'], process.cwd())); process.exit(0);
  }
  if (args.includes('push')) {
    const kind = args.some(a => a.endsWith(':refs/heads/control')) ? 'control' : process.cwd() === fs.realpathSync(config.verifier) ? 'suite' : args.some(a => a.endsWith(':refs/heads/main')) ? 'archive' : 'candidate';
    log({ effect: 'push', kind });
    if (scenario.pushBefore === kind && once('before-' + kind)) fail('synthetic push rejected before delivery');
    const result = cp.spawnSync(config.git, args, { stdio: 'inherit' });
    if (result.status === 0 && scenario.pushAfter === kind && once('after-' + kind)) fail('synthetic response lost after delivery');
    process.exit(result.status ?? 1);
  }
  const result = cp.spawnSync(config.git, args, { stdio: 'inherit' }); process.exit(result.status ?? 1);
}
if (args.includes('--version')) { output(tool === 'claude' ? '2.1.323 (Claude Code)' : tool === 'codex' ? 'codex-cli 0.167.2' : '2.0.0'); process.exit(0); }
if (tool === 'claude' && args[0] === 'auth') { output({ loggedIn:true, authMethod:'claude.ai', subscriptionType:'pro' }); process.exit(0); }
if (tool === 'codex' && args[0] === 'login') { output('Logged in using ChatGPT'); process.exit(0); }
if (tool === 'claude' || tool === 'codex') {
  const prompt = fs.readFileSync(0, 'utf8');
  const role = tool === 'codex' ? 'builder' : prompt.includes('Act as Scout') ? 'scout' : prompt.includes('acceptance-test Auditor') ? 'auditor-tests' : 'auditor-review';
  const model = args[args.indexOf('--model')+1];
  const usage = { input_tokens:10, output_tokens:5, cache_read_input_tokens:0, cache_creation_input_tokens:0 };
  log({ role, model, effort: tool === 'claude' ? args[args.indexOf('--effort')+1] : args.find(value => value.startsWith('model_reasoning_effort=')), ...(role === 'builder' || role === 'auditor-review' ? { prompt } : {}) });
  if (scenario.quotaRole === role) { output({ type: tool === 'claude' ? 'result' : 'turn.completed', model, usage }); fail('synthetic subscription quota exhausted'); }
  if (scenario.hangRole === role) { setInterval(() => {}, 1000); }
  else if (role === 'builder') {
    const settings = args.find(value => value.startsWith('mcp_servers='));
    const bridge = /command=("(?:\\.|[^"\\])*"),args=(\[.*?\]),required=true/.exec(settings ?? '');
    if (!bridge) fail('contained Builder bridge missing');
    let script = 'const fs=require("node:fs");fs.writeFileSync("app.cjs", "console.log(\\"ok\\");\\n");';
    if (scenario.builderLargeDiff) script += 'fs.writeFileSync("large.js","const publicValue = 12345;\\n".repeat(10000));';
    // Scratch now lives in the VM tmpfs /tmp, never in candidate capture.
    if (scenario.builderScratch) log({ effect:'builder-scratch-in-vm' });
    if (scenario.builderChangesConfig) script += 'fs.appendFileSync("aegean.json", " ");';
    if (scenario.builderOutsideScope) script += 'fs.writeFileSync("extra.txt", "outside the allowed paths\\n");';
    const request = {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'execute',arguments:{args:['node','-e',script],input:''}}};
    if (scenario.builderRepeatedOutput) {
      for (let index = 0; index < 10; index++) {
        log({ effect:'tool-output-call', index });
        const oversized = { ...request, params: { name:'execute', arguments: { args:['node','-e','process.stdout.write("x".repeat(70000))'], input:'' } } };
        const response = cp.spawnSync(JSON.parse(bridge[1]),JSON.parse(bridge[2]),{input:JSON.stringify(oversized)+'\n',encoding:'utf8',timeout:25000});
        if (response.status !== 0) fail('tool output stopped');
      }
    }
    const called = cp.spawnSync(JSON.parse(bridge[1]),JSON.parse(bridge[2]),{input:JSON.stringify(request)+'\n',encoding:'utf8',timeout:25000});
    if(called.status!==0) fail('fixture MCP client failed: '+called.stderr);
    const response=JSON.parse(called.stdout.trim());
    if(response.error) fail(JSON.stringify(response.error));
    const execution=JSON.parse(response.result.content[0].text);
    if(execution.code!==0||execution.interrupted) fail('fixture VM command failed: '+execution.stderr);
    output(JSON.stringify({ type:'turn.completed', model, usage: scenario.missingUsage === role ? undefined : usage }) + '\n');
  } else {
    const data = role === 'scout' ? { proposal:'## Why\nSynthetic fixture\n## What Changes\nReturn ok', requirements:'## ADDED Requirements\n### Requirement: Output\nThe CLI SHALL output ok.\n#### Scenario: Run\n- **WHEN** invoked\n- **THEN** output ok', design:'Synthetic design', tasks:'- [ ] Implement output', verification:'The check command runs the CLI and compares its output.', coverage:['Return ok: Requirement Output'], constraints:[], openQuestions:['Synthetic open question'], allowedPaths:['app.cjs', 'large.js'] } : role === 'auditor-tests' ? { schemaVersion:2, spec:run().spec, cases:[{ input:'', stdout:'ok', exit:0, requirement:'R001' }] } : { outcome:scenario.reviewOutcome ?? 'pass', findings:scenario.reviewFindings ?? [] };
    output({ type: 'result', model, result: scenario.malformedRole === role ? 'malformed JSON' : JSON.stringify(data), usage: scenario.missingUsage === role ? undefined : usage });
  }
} else if (tool === 'gh') {
  if (args[0] === 'pr' && args[1] === 'list') output(fs.existsSync(path.join(home,'pr.json')) ? [{number:1}] : []);
  else if (args[0] === 'pr' && args[1] === 'edit') {
    fs.writeFileSync(path.join(home,'pr-body.md'),fs.readFileSync(args[args.indexOf('--body-file')+1])); output('{}');
  }
  else if (args[0] === 'pr' && args[1] === 'create') {
    log({ effect:'pr-create' }); fs.writeFileSync(path.join(home,'pr.json'), '{}');
    if (scenario.prCreateAfter && once('pr-create')) fail('synthetic response lost after PR creation');
    output('https://github.com/fixture/project/pull/1');
  } else if (args[0] === 'api' && (args[1] === 'user' || args[1].startsWith('users/'))) output({id:scenario.authId ?? 1,login:scenario.authLogin ?? 'fixture',type:'User'});
  else if (args[0] === 'api' && args[1].includes('/comments')) {
    const current = run(); const comments=[];
    if(scenario.hangPublication && current.state==='human-merge-review'){log({effect:'publication-approval-read'});setInterval(()=>{},1000);}
    else {
    const user={id:scenario.approverId ?? (scenario.approver && scenario.approver !== 'fixture' ? 2 : 1),login:scenario.approver ?? 'fixture',type:'User'}; const created_at=new Date(current.updatedAt+2000).toISOString();
    if (scenario.approved) comments.push({user,created_at,body:`/aegean approve-spec ${scenario.approvalSpec ?? current.spec} ${scenario.approvalCommit ?? current.specCommit}`,html_url:'https://github.com/fixture/project/pull/1#issuecomment-1'});
    if (scenario.publishApproved) comments.push({user,created_at,body:`/aegean approve-publish ${scenario.publishCommit ?? current.commit} ${current.spec} ${current.suite} ${current.receipt}`,html_url:'https://github.com/fixture/project/pull/1#issuecomment-2'});
    output(comments);
    }
  } else if (args[0] === 'api' && args[1].includes('/pulls/')) {
    const current = run(); const head=git(['--git-dir',config.remote,'rev-parse',`refs/heads/aegean/${current.id}`]);
    output({ merged:!!scenario.merged, head:{sha:scenario.remoteHead ?? head,ref:`aegean/${current.id}`,repo:{full_name:'fixture/project'}}, base:{ref:'main',repo:{full_name:'fixture/project'}}, merge_commit_sha:current.commit, merged_by:{id:scenario.mergeActor && scenario.mergeActor !== 'fixture' ? 2 : 1,login:scenario.mergeActor ?? 'fixture',type:scenario.mergeType ?? 'User'} });
  } else fail('unexpected synthetic GitHub operation');
} else if (tool === 'docker') {
  const vmRoot=path.join(home,'synthetic-vm');fs.mkdirSync(vmRoot,{recursive:true});
  const metadata=path.join(vmRoot,'containers.json');
  const containers=fs.existsSync(metadata)?JSON.parse(fs.readFileSync(metadata,'utf8')):{};
  const save=()=>fs.writeFileSync(metadata,JSON.stringify(containers));
  if (args.includes('info')) output('29.5.2');
  else if (args.includes('rm') && scenario.cleanupFail) fail('synthetic cleanup unavailable');
  else if (args.includes('volume')) {
    const volume=args.at(-1);const target=path.join(vmRoot,volume);
    if(args.includes('create'))fs.mkdirSync(target,{recursive:true});
    else if(args.includes('rm'))fs.rmSync(target,{recursive:true,force:true});
    else if(args.includes('ls'))output('');
    else fail('unexpected synthetic volume operation');
  }
  else if (args.includes('container') && args.includes('ls')) {if(scenario.cleanupFail)fail('synthetic daemon unavailable');else output(Object.keys(containers).filter(name=>args.includes('name=^/'+name+'$')).join('\n'));}
  else if (args.includes('rm')) {delete containers[args.at(-1)];save();}
  else if (args.includes('run') && args.includes('--detach')) {
    const name=args[args.indexOf('--name')+1];
    const volume=/src=([^,]+)/.exec(args.find(arg=>arg.startsWith('type=volume,')))[1];
    const directory=path.join(vmRoot,volume);
    containers[name]={directory,collector:name.endsWith('-capture')};save();
    const seed=args.find(arg=>arg.startsWith('type=bind,'));
    if(seed)fs.cpSync(/src=([^,]+)/.exec(seed)[1],directory,{recursive:true});
    output(name);
  }
  else if(args.includes('exec')) {
    const name=args.find(arg=>Object.hasOwn(containers,arg));if(!name)fail('synthetic container missing');
    const invocation=args.slice(args.indexOf(name)+1);const item=containers[name];
    if(invocation.some(arg=>arg.includes('/tmp/aegean-ready')))process.exit(0);
    const input=fs.readFileSync(0);
    const result=cp.spawnSync(invocation[0]==='node'?process.execPath:invocation[0],[...invocation.slice(1),...(item.collector?[item.directory]:[])],{cwd:item.directory,input,encoding:'utf8',timeout:20000,maxBuffer:145000000});
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    // A collector snapshot can exceed a pipe buffer. Let Node drain both streams.
    process.exitCode = result.status ?? 1;
  }
  else if (args.includes('run')) {
    // Run the exported code, so that the base commit and the candidate give their real output.
    log({effect:'verify'});
    if (scenario.baselineInfraAlways || (scenario.baselineInfraOnce && once('baseline-infra'))) process.exit(125);
    const entry=args.indexOf('--entrypoint');const source=/src=([^,]+)/.exec(args.find(arg=>arg.startsWith('type=bind,')))[1];
    const executed=cp.spawnSync(args[entry+1]==='node'?process.execPath:args[entry+1],args.slice(entry+3),{cwd:source,input:fs.readFileSync(0),encoding:'utf8',timeout:10000});
    const passing=executed.status===0&&executed.stdout.trim()==='ok';
    if (scenario.verifierFail || (passing && scenario.verifierFailOnce && !args.includes('--check') && once('verifier-failure'))) output('wrong');
    else { process.stdout.write(executed.stdout ?? ''); process.exitCode = executed.status ?? 1; }
  }
  else if (!args.includes('inspect') && !args.includes('rm')) fail('unexpected synthetic Docker operation');
} else if (tool === 'openspec') {
  if (args[0] === 'archive') {
    log({effect:'archive'});
    const id=args[1]; const target=path.join('openspec/changes/archive', '2026-11-12-' + id);
    fs.mkdirSync('openspec/specs/contract', {recursive:true});
    fs.writeFileSync('openspec/specs/contract/spec.md', 'Synthetic accepted specification\n');
    if (scenario.archivePartial && once('archive-partial')) fail('synthetic archive interruption');
    fs.mkdirSync(path.dirname(target), {recursive:true}); fs.renameSync(path.join('openspec/changes',id),target);
    output('{}');
  } else if (args[0] === 'validate') output('{}');
  else fail('unexpected synthetic OpenSpec operation');
} else fail('unknown synthetic executable');
