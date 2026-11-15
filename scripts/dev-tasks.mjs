import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function execute(file, args, cwd) {
  await new Promise((done, fail) => {
    const child = spawn(file, args, { cwd, stdio: 'inherit', detached: process.platform !== 'win32' });
    let interrupted=false;let exited=false;let exitCode;let exitSignal;let timer;
    const group=signal=>{try{if(child.pid)process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
    const cleanup=()=>{process.off('SIGINT',int);process.off('SIGTERM',term);};
    const finish=()=>{if(!exited||timer)return;cleanup();exitCode===0&&!exitSignal&&!interrupted?done():fail(new Error(`${file} ${args.join(' ')} failed (${exitSignal??exitCode}); correct this step before retrying`));};
    const stop=()=>{
      if(interrupted)return;interrupted=true;group('SIGTERM');
      timer=setTimeout(()=>{
        try{group('SIGKILL');}catch(error){cleanup();error.uncertain=true;fail(error);return;}
        timer=undefined;finish();
      },750);
    };
    const int=()=>stop();const term=()=>stop();process.on('SIGINT',int);process.on('SIGTERM',term);
    child.once('error',error=>{clearTimeout(timer);cleanup();fail(error);});
    child.once('exit',(code,signal)=>{
      exited=true;exitCode=code;exitSignal=signal;
      if(!interrupted&&process.platform!=='win32'){
        try{process.kill(-child.pid,0);stop();}catch(error){if(error.code!=='ESRCH'){cleanup();error.uncertain=true;fail(error);return;}}
      }
      finish();
    });
  });
}
export async function runTask(root, task, run = execute) {
  if (!['setup','build','check','test'].includes(task)) throw new Error(`unknown task: ${task}`);
  root = await realpath(root);
  if (JSON.parse(await readFile(join(root,'package.json'),'utf8')).name !== '@you1anna/aegean') throw new Error('not an Aegean checkout');
  const pins = JSON.parse(await readFile(join(root,'toolchain.json'),'utf8'));
  if (process.versions.node !== pins.node) throw new Error(`Node ${pins.node} required; run ./scripts/dev setup`);
  const mise = await readFile(join(root,'mise.toml'),'utf8');
  if (!mise.includes(`node = "${pins.node}"`)) throw new Error('mise Node pin differs from toolchain.json');
  const state = join(root,'.aegean');
  try { await mkdir(state,{mode:0o700}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
  if ((await lstat(state)).isSymbolicLink() || !(await lstat(state)).isDirectory()) throw new Error('unsafe source task state');
  const lock = join(state,'source-task');
  try { await mkdir(lock,{mode:0o700}); } catch { throw new Error(`source tasks locked; inspect ${join(lock,'owner.json')}; never remove a live owner`); }
  let retain=false;
  try {
    await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,task,startedAt:Date.now()}),{flag:'wx',mode:0o600});
    const npm = args => run('npm',args,root);
    if (task === 'setup') {
      await npm(['ci','--ignore-scripts','--no-audit','--no-fund']);
      await npm(['ci','--prefix','tools','--ignore-scripts','--no-audit','--no-fund']);
    } else if (task === 'check') {
      await npm(['run','check']);
      for (const name of await readdir(join(root,'scripts'))) if(name.endsWith('.mjs')) await run(process.execPath,['--check',join(root,'scripts',name)],root);
      for (const name of ['dev','bootstrap.sh']) await run('/bin/sh',['-n',join(root,'scripts',name)],root);
    } else {
      const output = join(root,'dist');
      try {
        const info = await lstat(output);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('refusing symlink or non-directory compiled output');
        await rm(output,{recursive:true});
      } catch(error) { if(error.code !== 'ENOENT') throw error; }
      await npm(['run',task === 'test' ? 'test' : 'build']);
    }
  } catch(error) { retain=error.uncertain===true;throw error; } finally { if(!retain)await rm(lock,{recursive:true}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runTask(resolve(dirname(fileURLToPath(import.meta.url)),'..'),process.argv[2]); }
  catch(error) { console.error(error.message); process.exitCode = 1; }
}
