import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, access, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { checked } from '../src/adapters/process.js';
import { candidateGitChecked } from '../src/adapters/candidate-git.js';

test('candidate Git suppresses hooks and rejects filters, textconv and writable config includes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegean-git-safety-')); const repo = join(root, 'repo'); await mkdir(repo);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const raw = (args: string[]) => checked('git', args, { cwd: repo, env });
  const safe = (args: string[]) => candidateGitChecked(args, { cwd: repo, env });
  try {
    await raw(['init', '-b', 'main']); await raw(['config', 'user.name', 'Test']); await raw(['config', 'user.email', 'test@localhost']);
    await raw(['init', '--bare', join(root, 'remote.git')]); await raw(['remote', 'add', 'origin', join(root, 'remote.git')]);
    const sentinel = join(root, 'outside-write'); await mkdir(join(repo, '.husky'));
    await writeFile(join(repo, '.husky/pre-push'), `#!/bin/sh\nprintf hook > '${sentinel}'\n`); await chmod(join(repo, '.husky/pre-push'), 0o755);
    await raw(['config', 'core.hooksPath', '.husky']); await writeFile(join(repo, 'file.txt'), 'before\n');
    await safe(['add', '-A']); await safe(['commit', '-m', 'seed']); await safe(['push', 'origin', 'main']); await assert.rejects(access(sentinel));
    await writeFile(join(repo, 'filter.sh'), `#!/bin/sh\nprintf filter > '${sentinel}'\ncat\n`);
    await raw(['config', 'diff.external', 'sh ./filter.sh']); await writeFile(join(repo, 'file.txt'), 'after\n');
    await safe(['diff']); await assert.rejects(access(sentinel)); await raw(['config', '--unset', 'diff.external']);
    await writeFile(join(repo, '.gitattributes'), '*.txt filter=custom diff=custom\n');
    await raw(['config', 'filter.custom.clean', 'sh ./filter.sh']);
    await assert.rejects(safe(['add', '-A']), /unsupported executable Git/); await assert.rejects(access(sentinel));
    await assert.rejects(candidateGitChecked(['add', '-A'], { cwd: repo, env: { ...env, GIT_CONFIG: '/dev/null' } }), /unsupported executable Git/); await assert.rejects(access(sentinel));
    await raw(['config', '--unset', 'filter.custom.clean']); await raw(['config', 'diff.custom.textconv', 'sh ./filter.sh']);
    await assert.rejects(safe(['diff']), /unsupported executable Git/); await assert.rejects(access(sentinel));
    await raw(['config', '--unset', 'diff.custom.textconv']);
    await writeFile(join(repo, 'candidate.config'), '[core]\n hooksPath = .husky\n'); await raw(['config', 'include.path', '../candidate.config']);
    await assert.rejects(safe(['status', '--porcelain']), /candidate-controlled Git config/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('candidate Git rejects nested repositories before their filters can run', async () => {
  const root=await mkdtemp(join(tmpdir(),'aegean-nested-git-'));const outer=join(root,'outer');const nested=join(outer,'nested');await mkdir(nested,{recursive:true});
  const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
  const git=(cwd:string,args:string[])=>checked('git',args,{cwd,env});
  try{
    for(const cwd of [outer,nested]){await git(cwd,['init','-b','main']);await git(cwd,['config','user.name','Test']);await git(cwd,['config','user.email','test@localhost']);}
    const sentinel=join(root,'outside-write');await writeFile(join(nested,'file.txt'),'before');await writeFile(join(nested,'.gitattributes'),'*.txt filter=probe\n');
    await writeFile(join(nested,'filter.sh'),`#!/bin/sh\nprintf nested > '${sentinel}'\ncat\n`);await git(nested,['add','.']);await git(nested,['commit','-m','seed']);
    await assert.rejects(candidateGitChecked(['add','-A'],{cwd:outer,env}),/nested Git/);
    await rename(join(nested,'.git'),join(nested,'.GiT'));
    await assert.rejects(candidateGitChecked(['add','-A'],{cwd:outer,env}),/nested Git/);
    await rename(join(nested,'.GiT'),join(nested,'.git'));
    await git(outer,['add','nested']);await git(outer,['commit','-m','gitlink']);await git(nested,['config','filter.probe.clean','sh ./filter.sh']);await writeFile(join(nested,'file.txt'),'after!');
    for(const args of [['status','--porcelain'],['add','-A'],['diff']])await assert.rejects(candidateGitChecked(args,{cwd:outer,env}),/nested Git|gitlinks/);
    await assert.rejects(access(sentinel));
  }finally{await rm(root,{recursive:true,force:true});}
});
