const commands:Record<string,{usage:string;flags:string[];switches?:string[];repeat?:string[];words?:number}>={
  info:{usage:'info [--json]',flags:[],switches:['--json']},
  doctor:{usage:'doctor [--json] [--require prerequisites|full]',flags:['--require'],switches:['--json']},
  auth:{usage:'auth status | auth login claude|codex',flags:[],words:2},
  verifier:{usage:'verifier status|start|stop | verifier recover --confirm-stopped',flags:[],words:1,switches:['--confirm-stopped']},
  project:{usage:'project check [--json]',flags:[],words:1,switches:['--json']},
  prepare:{usage:'prepare --request FILE',flags:['--request']},start:{usage:'start --request FILE',flags:['--request']},
  'authorize-pilot':{usage:'authorize-pilot --run ID --limits FILE | --expires-at ISO --max-model-calls N --active-minutes N --max-repairs N --max-revisions N',flags:['--run','--limits','--expires-at','--max-model-calls','--active-minutes','--max-repairs','--max-revisions']},
  status:{usage:'status [--run ID]',flags:['--run']},resume:{usage:'resume --run ID',flags:['--run']},
  approve:{usage:'approve --run ID',flags:['--run']},publish:{usage:'publish --run ID',flags:['--run']},cancel:{usage:'cancel --run ID',flags:['--run']},
  recover:{usage:'recover --run ID --confirm-stopped',flags:['--run'],switches:['--confirm-stopped']},
  revise:{usage:'revise --run ID --scope implementation|contract',flags:['--run','--scope']},
  qualify:{usage:'qualify',flags:[]},
  configure:{usage:'configure [--control-remote URL --verifier-checkout PATH] --exclude PATH [--exclude PATH ...]',flags:['--control-remote','--verifier-checkout','--image','--exclude'],repeat:['--exclude']},
  enrol:{usage:'enrol --check | --config FILE',flags:['--config'],switches:['--check']},
  'accept-release':{usage:'accept-release --manifest FILE',flags:['--manifest']},
  'migrate-control':{usage:'migrate-control --approver LOGIN',flags:['--approver']},
  upgrade:{usage:'upgrade --source PATH',flags:['--source']},rollback:{usage:'rollback',flags:[]},
  uninstall:{usage:'uninstall --confirm',flags:[],switches:['--confirm']},
  'activate-routing':{usage:'activate-routing --project OWNER/REPO --project-path PATH [repeat pairs]',flags:['--project','--project-path'],repeat:['--project','--project-path']},
  'deactivate-routing':{usage:'deactivate-routing',flags:[]},'migrate-routing':{usage:'migrate-routing',flags:[]},'recover-routing':{usage:'recover-routing',flags:[]},
};
export function commandHelp(command?:string){
  if(command){if(!commands[command])throw new Error(`unknown command: ${command}`);return `Usage: aegean ${commands[command].usage}`;}
  return `Aegean — local build: ./scripts/dev help; installed commands:\n\n${Object.values(commands).map(c=>'  '+c.usage).join('\n')}\n\nCommands preserve separate human approval and release acceptance gates. See aegean info for the installed guide.`;
}
export function validateArguments(args:string[]):string|undefined{
  if(!args.length||['help','--help','-h'].includes(args[0]!))return commandHelp(args[0]==='help'?args[1]:undefined);
  if(args[0]==='--version'){if(args.length!==1)throw new Error('unexpected version arguments');return;}
  const spec=commands[args[0]!];if(!spec)throw new Error(`unknown command: ${args[0]}`);
  if(args.includes('--help')||args.includes('-h'))return commandHelp(args[0]);
  const seen=new Set<string>();let words=0;
  for(let i=1;i<args.length;i++){
    const arg=args[i]!;
    if(!arg.startsWith('-')){words++;continue;}
    if(!spec.flags.includes(arg)&&!spec.switches?.includes(arg))throw new Error(`unknown option ${arg}; ${commandHelp(args[0])}`);
    if(seen.has(arg)&&!spec.repeat?.includes(arg))throw new Error(`duplicate option: ${arg}`);seen.add(arg);
    if(spec.flags.includes(arg)){if(!args[i+1]||args[i+1]!.startsWith('--'))throw new Error(`${arg} requires a value`);i++;}
  }
  if(words>(spec.words??0))throw new Error(`unexpected arguments; ${commandHelp(args[0])}`);
  if(args.includes('--limits')&&['--expires-at','--max-model-calls','--active-minutes','--max-repairs','--max-revisions'].some(f=>args.includes(f)))throw new Error('limits file cannot be combined with individual pilot flags');
  if(args[0]==='verifier'&&args.includes('--confirm-stopped')&&args[1]!=='recover')throw new Error('--confirm-stopped is only valid for verifier recover');
  return;
}
const hints:[RegExp,string][]=[
  [/--run is required/,'Give the run identifier with --run ID. Run aegean status to list the runs. A run exists only after aegean prepare --request FILE.'],
  [/--request is required/,'Give the request file: aegean prepare --request FILE. Run the command in the project repository.'],
  [/(--limits|--expires-at) (is required|requires a value)/,'Give the reviewed limits file: aegean authorize-pilot --run ID --limits FILE.'],
  [/invalid run identifier|unknown run/,'Copy the complete run identifier from aegean status.'],
  [/pilot authorization (expired|with different limits)|already has a pilot authorization/,'One pilot authorisation applies to one run. Run aegean status --run ID to see the next step.'],
  [/commit or preserve current work/,'Commit the project changes, push main to origin, then run the command again.'],
  [/start from the reviewed remote main revision/,'Make the local main branch and origin/main the same revision, then run the command again.'],
  [/required context (missing|exceeds)|protected or invalid required context/,'Correct modelExecution.task.paths in aegean.json. Run aegean project check to see the files that the agents read.'],
  [/Pilot authorization required/,'Authorise the pilot, then run aegean resume --run ID.'],
];
/** Advice only; it never changes the failure or its exit code. */
export function recoveryHint(command:string|undefined,message:string):string{
  if(command==='configure')return 'Inspect host configuration in the operations guide before retrying.';
  return hints.find(([pattern])=>pattern.test(message))?.[1]??'Run aegean status and inspect the operations guide before retrying effects.';
}
