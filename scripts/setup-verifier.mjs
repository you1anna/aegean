import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { ensureDocker } from './docker-client.mjs';
import { execFileSync } from 'node:child_process';

/** Internal test edges; the executable entry always uses the real adapters. */
export async function setupVerifier(root, user, edges) {
  const {verifier:v}=JSON.parse(await readFile(join(root,'toolchain.json'),'utf8'));
  if(edges.platform!=='darwin')throw new Error('This verifier bootstrap targets macOS');
  const release=await edges.reserve(join(user,'.local/state/aegean'),'transition','verifier-setup');
  let mutating=false;let completed=false;
  try{
    await edges.quiescent();
    const docker = await edges.docker(v);
    for(const [tool,version] of [['colima',v.colima],[docker,v.dockerClient]]){
      const actual=await edges.run(tool,['--version']);
      if(!new RegExp(`(^|[^\\d])${version.replaceAll('.', '\\.')}([^\\d]|$)`).test(actual))throw new Error(`${tool} version drift; expected ${version}; install the reviewed pinned version`);
    }
    await mkdir(v.candidateRoot,{recursive:true,mode:0o700});
    if((await lstat(v.candidateRoot)).isSymbolicLink())throw new Error('verifier candidate root must not be a symlink');
    mutating=true;
    await edges.run('colima',edges.startArgs(v),180000);
    const profile=join(user,'.colima',v.profile,'colima.yaml');
    if((await lstat(profile)).isSymbolicLink())throw new Error('verifier profile must not be a symlink');
    const config=await readFile(profile,'utf8');
    await writeFile(profile,config.replace(/^autoActivate: true$/m,'autoActivate: false'));
    await edges.run(docker,['--context',`colima-${v.profile}`,'pull',v.image],180000);
    completed=true;
    return {profile:v.profile,provisioned:true,contextPreserved:true};
  }finally{if(completed||!mutating)await release();}
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {verifierStartArgs}=await import(pathToFileURL(join(root,'dist/src/domain/verifier-plan.js')).href);
  const {reserveHost}=await import(pathToFileURL(join(root,'dist/src/adapters/host-activity.js')).href);
  const {assertHostQuiescent}=await import(pathToFileURL(join(root,'dist/src/application/operator.js')).href);
  const user=homedir();
  const quiescent=async()=>{try{await lstat(join(user,'.local/state/aegean/settings.json'));}catch(e){if(e.code==='ENOENT')return;throw e;}await assertHostQuiescent();};
  console.log(JSON.stringify(await setupVerifier(root,user,{platform:process.platform,reserve:reserveHost,startArgs:verifierStartArgs,quiescent,
    docker: async v => { const binary = await ensureDocker(user, v); process.env.PATH = `${dirname(binary)}:${process.env.PATH ?? ''}`; return binary; },
    run:async(file,args,timeout=30000)=>execFileSync(file,args,{encoding:'utf8',timeout,stdio:['inherit','pipe','inherit']})})));
}
