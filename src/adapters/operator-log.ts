import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const segmentBytes=5*1024*1024;const segments=4;
export class OperatorLog {
  readonly path:string;private fd:number;private segment=0;private bytes=0;private omitted=false;private startedAt=Date.now();
  constructor(directory=join(homedir(),'Library/Logs/aegean')) {
    directory=resolve(directory);
    // Validate each existing parent without following symlinks.
    let cursor=directory;const missing:string[]=[];
    for(;;){try{const info=lstatSync(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('unsafe log directory');break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;missing.push(cursor);cursor=dirname(cursor);}}
    for(const part of missing.reverse())mkdirSync(part,{mode:0o700});
    for(let p=directory;p!==dirname(p);p=dirname(p)){if(lstatSync(p).isSymbolicLink())throw new Error('symlink log parent refused');}
    if((lstatSync(directory).mode&0o077)!==0)throw new Error('log directory must be private (chmod 700)');
    this.path=join(directory,`${Date.now()}-${randomUUID()}.jsonl`);
    this.fd=openSync(this.path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  }
  /** Only callers' structured public metadata is recorded. Never pass error text or role output. */
  event(event:'begin'|'stage'|'complete'|'failed'|'interrupted',fields:{command?:string;run?:string;role?:string;code?:number;release?:string;failure?:string}={}) {
    const safe:Record<string,unknown>={at:new Date().toISOString(),event,elapsedMs:Date.now()-this.startedAt};
    for(const key of ['command','run','role','release','failure'] as const){const value=fields[key];if(value!==undefined){if(!/^[a-z0-9-]{1,100}$/.test(value))throw new Error('unsafe diagnostic field');safe[key]=value;}}
    if(fields.code!==undefined)safe.code=fields.code;
    this.append(JSON.stringify(safe)+'\n');
  }
  append(text:string) {
    if(this.omitted)return;
    let data=Buffer.from(text);
    while(data.length){
      const available=segmentBytes-this.bytes;
      if(data.length<=available){this.write(data);return;}
      // Reserve space for a visible marker before the last segment fills.
      if(this.segment===segments-1){const marker=Buffer.from('{"event":"output-omitted","limitBytes":20971520}\n');if(available>=marker.length)this.write(marker);this.omitted=true;process.stderr.write('Aegean diagnostic log reached 20 MiB; further diagnostics omitted.\n');return;}
      if(available){this.write(data.subarray(0,available));data=data.subarray(available);}
      closeSync(this.fd);this.segment++;this.bytes=0;this.fd=openSync(`${this.path}.${this.segment}`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    }
  }
  private write(data:Buffer){let offset=0;while(offset<data.length)offset+=writeSync(this.fd,data,offset,data.length-offset);this.bytes+=data.length;}
  close(){if(this.fd>=0){closeSync(this.fd);this.fd=-1;}}
  check(){if(this.fd<0||!fstatSync(this.fd).isFile())throw new Error('diagnostic log unavailable');}
}
let active:OperatorLog|undefined;
export function setOperatorLog(log:OperatorLog|undefined){active=log;}
export function operatorStage(run:string,role:string){active?.check();active?.event('stage',{run,role});}

export function failureCode(message:string):string {
  for(const [pattern,code] of [[/budget|allowance|quota/,'budget'],[/auth|subscription|login/,'authentication'],[/pilot|approval|decision/,'approval'],[/ownership|owner|permit|locked|intent/,'ownership'],[/config|schema|modelExecution/,'configuration'],[/verifier|docker|colima|VM/,'verifier'],[/log|diagnostic/,'logging']] as const) if(pattern.test(message))return code;
  return 'operation-failed';
}
