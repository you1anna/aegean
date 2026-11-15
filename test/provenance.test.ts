import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, readlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checked } from '../src/adapters/process.js';

test('provenance rejects dirty sources and installer rebuilds from the recorded commit, excluding stale dist', async () => {
  const root=await mkdtemp(join(tmpdir(),'aegean-provenance-test-')); const repo=join(root,'source'); const user=join(root,'user'); const bin=join(root,'bin');
  try {
    for(const path of [repo,user,bin,...['scripts','docs','skills','policy','tools'].map(p=>join(repo,p))]) await mkdir(path,{recursive:true});
    await cp('scripts', join(repo, 'scripts'), { recursive: true });
    const pins = { ...JSON.parse(await readFile('toolchain.json', 'utf8')), node: process.versions.node };
    await writeFile(join(repo,'toolchain.json'),JSON.stringify(pins));
    const pkg={name:'synthetic-release',version:'0.1.0',type:'module',scripts:{build:'node build.mjs'}};
    const { dependencies } = JSON.parse(await readFile('package.json', 'utf8'));
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
    const app = { ...pkg, dependencies };
    await writeFile(join(repo, 'package.json'), JSON.stringify(app));
    await writeFile(join(repo, 'package-lock.json'), JSON.stringify({
      ...lock, name: app.name, version: app.version,
      packages: { ...lock.packages, '': app },
    }));
    await writeFile(join(repo, 'tools/package.json'), JSON.stringify(pkg));
    await writeFile(join(repo, 'tools/package-lock.json'), JSON.stringify({
      name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': pkg },
    }));
    const output:Record<string,string>={
      'app.js':'fresh committed build',
      'toolchain.json':JSON.stringify(pins),
    };
    await writeFile(join(repo,'build-output.json'),JSON.stringify(output));
    await cp('dist/src', join(repo, 'compiled-source'), { recursive: true });
    await writeFile(join(repo, 'build.mjs'), `
      import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
      await mkdir('dist', { recursive: true });
      await cp('compiled-source', 'dist/src', { recursive: true });
      const output = JSON.parse(await readFile('build-output.json', 'utf8'));
      for (const [name, value] of Object.entries(output)) await writeFile('dist/' + name, value);
    `);
    await writeFile(join(repo,'policy/ROUTING.md'),'Synthetic fixture policy.');
    await writeFile(join(repo,'docs/fixture.md'),'Synthetic fixture.'); await writeFile(join(repo,'skills/fixture.md'),'Synthetic fixture.');
    await writeFile(join(repo,'.gitignore'),'dist/\nnode_modules/\n');
    await symlink('docs/fixture.md',join(repo,'link'));
    await writeFile(join(bin,'claude'),'#!/bin/sh\necho "2.1.322 (Claude Code)"\n',{mode:0o755});
    const env={...process.env,PATH:bin+':'+process.env.PATH,npm_config_offline:'true',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
    const git=(args:string[])=>checked('git',args,{cwd:repo,env});
    await git(['init','-b','main']);await git(['add','.']);await git(['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture']);
    const {sourceProvenance}=await import(pathToFileURL(resolve('scripts/source-provenance.mjs')).href);
    const identity=sourceProvenance(repo);
    await mkdir(join(repo,'dist'));await writeFile(join(repo,'dist/app.js'),'untrusted stale output');await writeFile(join(repo,'dist/obsolete.js'),'untracked old executable');
    assert.deepEqual(sourceProvenance(repo),identity);
    await writeFile(join(repo,'untracked'),'uncommitted');assert.throws(()=>sourceProvenance(repo),/clean committed/);await rm(join(repo,'untracked'));
    await checked(process.execPath,[join(repo,'scripts/install.mjs'),'--user-root',user],{cwd:repo,env,timeoutMs:30000});
    const release=await readlink(join(user,'.local/share/aegean/current'));
    const installed=JSON.parse(await readFile(join(release,'installation.json'),'utf8'));
    assert.equal(installed.sourceCommit,identity.sourceCommit);assert.equal(installed.sourceHash,identity.sourceHash);assert.match(installed.buildHash,/^[a-f0-9]{64}$/);
    assert.equal(await readFile(join(release,'dist/app.js'),'utf8'),'fresh committed build');
    await assert.rejects(readFile(join(release,'dist/obsolete.js')));
  }finally{await rm(root,{recursive:true,force:true});}
});
