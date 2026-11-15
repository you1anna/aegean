import { spawn } from 'node:child_process';
/** Authentication alone needs inherited terminal descriptors. Never use for candidate code. */
export async function interactiveProcess(file: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('login requires an interactive terminal');
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(file,args,{stdio:'inherit',env});
    const abort=()=>child.kill('SIGTERM'); signal.addEventListener('abort',abort,{once:true});
    const cleanup=()=>signal.removeEventListener('abort',abort);
    child.once('error',e=>{cleanup();reject(e);});
    child.once('exit',(code,killed)=>{cleanup();code===0&&!killed?resolve():reject(new Error(`login failed (${killed??code}); run aegean auth status`));});
    if(signal.aborted) abort();
  });
}
