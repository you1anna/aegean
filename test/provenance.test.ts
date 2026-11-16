import { createHash } from 'node:crypto';
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
    await cp('examples', join(repo, 'examples'), { recursive: true });
    const pins = { ...JSON.parse(await readFile('toolchain.json', 'utf8')), node: process.versions.node };
    const dockerBytes = '#!/bin/sh\necho synthetic-docker\n';
    pins.verifier.dockerArtifacts[process.arch] = { archiveSha256: '0'.repeat(64), binarySha256: createHash('sha256').update(dockerBytes).digest('hex') };
    const dockerDirectory = join(user, '.local/share/aegean/host-tools', `docker-${pins.verifier.dockerClient}-${process.arch}`);
    await mkdir(dockerDirectory, { recursive: true });
    await writeFile(join(dockerDirectory, 'docker'), dockerBytes, { mode: 0o755 });
    // The synthetic release also runs on Linux CI; platform rejection has its own test.
    const dockerScript = join(repo, 'scripts/docker-client.mjs');
    await writeFile(dockerScript, (await readFile(dockerScript, 'utf8')).replace('options.platform ?? process.platform', "options.platform ?? 'darwin'"));
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
      'src/cli.js':"import {execFileSync} from 'node:child_process'; console.log(execFileSync('docker',['--version'],{encoding:'utf8'}).trim()); console.log(execFileSync('claude',['--version'],{encoding:'utf8'}).trim());",
      'toolchain.json':JSON.stringify(pins),
    };
    await writeFile(join(repo,'build-output.json'),JSON.stringify(output));
    await cp('dist/src', join(repo, 'compiled-source'), { recursive: true });
    await writeFile(join(repo, 'build.mjs'), `
      import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
      await mkdir('dist', { recursive: true });
      await cp('compiled-source', 'dist/src', { recursive: true });
      await mkdir('dist/scripts', { recursive: true });
      await cp('scripts/cli-version.mjs', 'dist/scripts/cli-version.mjs');
      const output = JSON.parse(await readFile('build-output.json', 'utf8'));
      for (const [name, value] of Object.entries(output)) await writeFile('dist/' + name, value);
    `);
    await writeFile(join(repo,'policy/ROUTING.md'),'Synthetic fixture policy.');
    await writeFile(join(repo,'docs/fixture.md'),'Synthetic fixture.'); await writeFile(join(repo,'skills/fixture.md'),'Synthetic fixture.');
    await writeFile(join(repo,'.gitignore'),'dist/\nnode_modules/\n');
    await symlink('docs/fixture.md',join(repo,'link'));
    await writeFile(join(bin,'claude'),'#!/bin/sh\necho "2.1.323 (Claude Code)"\n',{mode:0o755});
    const env={...process.env,PATH:bin+':'+process.env.PATH,npm_config_offline:'true',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
    const git=(args:string[])=>checked('git',args,{cwd:repo,env});
    await git(['init','-b','main']);await git(['add','.']);await git(['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture']);
    const {sourceProvenance}=await import(pathToFileURL(resolve('scripts/source-provenance.mjs')).href);
    const identity=sourceProvenance(repo);
    await mkdir(join(repo,'dist'));await writeFile(join(repo,'dist/app.js'),'untrusted stale output');await writeFile(join(repo,'dist/obsolete.js'),'untracked old executable');
    assert.deepEqual(sourceProvenance(repo),identity);
    await writeFile(join(repo,'untracked'),'uncommitted');assert.throws(()=>sourceProvenance(repo),/clean committed/);await rm(join(repo,'untracked'));
    for (const rejected of ['2.1.321', '3.0.0', '2.1.323-beta.1']) {
      await writeFile(join(bin,'claude'),`#!/bin/sh\necho "${rejected} (Claude Code)"\n`,{mode:0o755});
      await assert.rejects(checked(process.execPath,[join(repo,'scripts/install.mjs'),'--user-root',user],{cwd:repo,env,timeoutMs:30000}), /Claude >=2\.1\.322 <3\.0\.0 required/);
      await assert.rejects(readlink(join(user,'.local/share/aegean/current')), {code:'ENOENT'});
    }
    await writeFile(join(bin,'claude'),'#!/bin/sh\necho "2.1.323 (Claude Code)"\n',{mode:0o755});
    await checked(process.execPath,[join(repo,'scripts/install.mjs'),'--user-root',user],{cwd:repo,env,timeoutMs:30000});
    const release=await readlink(join(user,'.local/share/aegean/current'));
    assert.deepEqual(JSON.parse(await readFile(join(release,'tool-versions.json'),'utf8')), {claude:'2.1.323'});
    await checked(process.execPath,[join(repo,'scripts/install.mjs'),'--user-root',user],{cwd:repo,env,timeoutMs:30000});
    assert.equal(await readlink(join(user,'.local/share/aegean/current')),release);
    const installed=JSON.parse(await readFile(join(release,'installation.json'),'utf8'));
    assert.equal(await readFile(join(release,'bin/docker-client/docker'),'utf8'), dockerBytes);
    assert.match(await readFile(join(user,'.local/bin/aegean'),'utf8'), /current\/bin/);
    await writeFile(join(bin,'docker'),'#!/bin/sh\nexit 99\n',{mode:0o755});
    await writeFile(join(bin,'claude'),'#!/bin/sh\necho external-new-claude\n',{mode:0o755});
    assert.equal((await checked(join(user,'.local/bin/aegean'),[],{env})).trim(),'synthetic-docker\nexternal-new-claude');
    assert.equal(installed.sourceCommit,identity.sourceCommit);assert.equal(installed.sourceHash,identity.sourceHash);assert.match(installed.buildHash,/^[a-f0-9]{64}$/);
    assert.equal(await readFile(join(release,'dist/app.js'),'utf8'),'fresh committed build');
    await assert.rejects(readFile(join(release,'dist/obsolete.js')));
    for(const name of ['aegean.json','pilot-limits.json']) assert.equal(await readFile(join(release,'examples',name),'utf8'),await readFile(join(repo,'examples',name),'utf8'));
    const artifacts=JSON.parse(await readFile(join(release,'artifact-manifest.json'),'utf8'));assert.ok(artifacts.some((entry:{path:string})=>entry.path==='examples/pilot-limits.json'));
    assert.ok(artifacts.some((entry:{path:string})=>entry.path==='tool-versions.json'));
  }finally{await rm(root,{recursive:true,force:true});}
});
