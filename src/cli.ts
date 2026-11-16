#!/usr/bin/env node
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { doctor, configure, binaries, acceptRelease, stateRoot, hostConfig } from './application/runtime.js';
import packageInfo from '../package.json' with { type: 'json' };
import { enrol } from './application/enrol.js';
import { start, resume, status, cancel } from './application/engine.js';
import { checked } from './adapters/process.js';
import { qualifyHost } from './application/qualification.js';
import { decide } from './application/decision-commands.js';
import { migrateControl } from './application/control-migration.js';
import { recover } from './application/recovery.js';
import { prepareRun } from './application/prepare.js';
import { checkProject, agentContext } from './application/project-check.js';
import { releaseInfo, authCommand, verifierCommand } from './application/operator.js';
import { parsePilotLimits } from './domain/pilot-limits.js';
import { validateArguments, recoveryHint } from './application/cli-arguments.js';
import { reserveHost } from './adapters/host-activity.js';
import { OperatorLog, setOperatorLog, failureCode } from './adapters/operator-log.js';
import { readBoundedEvidenceFile } from './adapters/acceptance-evidence.js';
import { guide } from './application/guide.js';
import { terminalUi, openEditor } from './adapters/terminal.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const flag = (args: string[], name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const requiredFlag = (args: string[], name: string): string => { const value = flag(args, name); if (!value || value.startsWith('--')) throw new Error(`${name} is required`); return value; };
const repeatedFlag = (args: string[], name: string): string[] => args.flatMap((arg, index) => {
  if (arg !== name) return [];
  const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return [value];
});
const controller = new AbortController();
process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
/**
 * One command from validated arguments to its result. The command line and the guide both use this function,
 * so the diagnostic log, the host reservation and each gate are the same on both routes.
 */
async function dispatch(args: string[], report: (line: string) => void = line => console.error(line)): Promise<unknown> {
  const flagValue = (name: string) => flag(args, name), required = (name: string) => requiredFlag(args, name), repeated = (name: string) => repeatedFlag(args, name);
  const optional = (name: string): string | undefined => args.includes(name) ? required(name) : undefined;
  let log: OperatorLog | undefined;
  let hostRelease: (()=>Promise<void>) | undefined;
  try {
    if (['start','prepare','resume','cancel','recover','publish'].includes(args[0] ?? '')) {
      log = new OperatorLog(); setOperatorLog(log);
      const installed=await releaseInfo(root).catch(()=>undefined);
      log.event('begin', {command: args[0]!, ...(installed?.sourceCommit ? {release:installed.sourceCommit} : {})});
      report(`Private diagnostic log: ${log.path}`);
    }
    if (['start','prepare','cancel','recover','approve','publish','authorize-pilot','revise'].includes(args[0] ?? '')) hostRelease=await reserveHost(stateRoot(),'execution',args[0]!);
    let result: unknown;
    switch (args[0]) {
      case 'guide': throw new Error('the guide cannot start from itself');
      case 'info': result = await releaseInfo(root); break;
      case 'auth': result = await authCommand(root,args[1] ?? '',args[2],controller.signal); break;
      case 'verifier': result = await verifierCommand(args[1] ?? '',controller.signal,args.includes('--confirm-stopped')); break;
      case 'project': if(args[1] !== 'check') throw new Error('Usage: aegean project check'); { const check = await checkProject(process.cwd(),controller.signal); result = { ...check, agentContext: await agentContext(check.repo, check.project) }; break; }
      case 'prepare': result = await prepareRun(process.cwd(),(await readBoundedEvidenceFile(resolve(required('--request')),60_000)).toString('utf8'),controller.signal); break;
      case 'doctor': {
        const mode=optional('--require'); if(mode && !['prerequisites','full'].includes(mode)) throw new Error('--require must be prerequisites or full');
        const report=await doctor(root); result=report;
        if(mode && !(mode === 'full' ? report.fullWorkflowReady : report.prerequisitesReady)) process.exitCode=1;
        break;
      }
      case 'qualify': { const release=await reserveHost(stateRoot(),'execution','qualify'); try { result = await qualifyHost(root, stateRoot(), (await hostConfig()).host, controller.signal); } finally { await release(); } break; }
      case 'configure': result = await configure({ controlRemote: optional('--control-remote'), verifierCheckout: optional('--verifier-checkout'), image: optional('--image'), excludedRoots: repeated('--exclude') }); break;
      case 'accept-release': result = await acceptRelease(root, required('--manifest')); break;
      case 'enrol': result = await enrol(process.cwd(), flagValue('--config'), binaries(root).openspec, args.includes('--check')); break;
      case 'start': result = await start(root, process.cwd(), await readFile(required('--request'), 'utf8'), controller.signal); break;
      case 'authorize-pilot':
        if (optional('--limits')) { result=await decide(root,required('--run'),'pilot',parsePilotLimits(JSON.parse((await readBoundedEvidenceFile(resolve(required('--limits')),8192)).toString('utf8'))),controller.signal); break; }
        result = await decide(root, required('--run'), 'pilot', { expiresAt: Date.parse(required('--expires-at')), budget: { maxModelCalls: Number(required('--max-model-calls')), activeTimeoutMs: Number(required('--active-minutes')) * 60000, maxRepairs: Number(required('--max-repairs')), maxRevisions: Number(required('--max-revisions')) } }, controller.signal); break;
      case 'approve': result = await decide(root, required('--run'), 'approve', {}, controller.signal); break;
      case 'publish':
        await decide(root, required('--run'), 'publish', {}, controller.signal);
        result = await resume(root, required('--run'), controller.signal); break;
      case 'revise': {
        const scope = required('--scope'); if (scope !== 'implementation' && scope !== 'contract') throw new Error('scope must be implementation or contract');
        result = await decide(root, required('--run'), 'revise', { scope }, controller.signal); break;
      }
      case 'migrate-control': result = await migrateControl(root, required('--approver'), controller.signal); break;
      case 'resume': result = await resume(root, required('--run'), controller.signal); break;
      case 'status': result = await status(flagValue('--run')); break;
      case 'cancel': result = await cancel(required('--run'), root); break;
      case 'recover': result = await recover(required('--run'), args.includes('--confirm-stopped'), root); break;
      case 'activate-routing': case 'deactivate-routing': case 'migrate-routing': case 'recover-routing':
        result = await checked(process.execPath, [join(root, 'scripts/install.mjs'), `--${args[0]}`, ...repeated('--project').flatMap(value => ['--project', value]), ...repeated('--project-path').flatMap(value => ['--project-path', value])], { timeoutMs: 60000, signal: controller.signal }); break;
      case 'uninstall': if(!args.includes('--confirm')) throw new Error('Uninstall requires --confirm; preserves records and creates a recovery backup'); result=await checked(process.execPath,[join(root,'scripts/uninstall.mjs'),'--confirm'],{timeoutMs:120000,signal:controller.signal}); break;
      case 'rollback': result = await checked(process.execPath, [join(root, 'scripts/install.mjs'), '--rollback'], { timeoutMs: 30000 }); break;
      case 'upgrade':
        result = await checked('/bin/sh', [join(resolve(required('--source')), 'scripts/bootstrap.sh')], { timeoutMs: 600000 }); break;
      case '--version': result = { version: packageInfo.version }; break;
      default: throw new Error(`unknown command: ${args[0]}`);
    }
    const summary=result && typeof result==='object' ? result as {id?:string;run?:{id?:string}} : undefined;
    const runId=summary?.id ?? summary?.run?.id ?? optional('--run');
    log?.event('complete',{command:args[0]!, ...(runId ? {run:runId} : {})});
    if(log) report(`Pilot note: command=${args[0]} run=${runId??'none'} result=completed log=${log.path}`);
    return result;
  } catch (error) {
    try { log?.event(controller.signal.aborted?'interrupted':'failed',{command:args[0]!,code:controller.signal.aborted?130:1,failure:failureCode((error as Error).message)}); } catch { report('Private diagnostic capture failed; inspect retained run records.'); }
    throw error;
  } finally { setOperatorLog(undefined); log?.close(); await hostRelease?.(); }
}

let args = process.argv.slice(2);
// At a terminal, the command without arguments starts the guide. Other callers get the command list.
if (!args.length && process.stdin.isTTY && process.stdout.isTTY) args = ['guide'];
try {
  const help = validateArguments(args);
  if (help) { console.log(help); process.exit(0); }
  if (args[0] === 'guide') {
    const ui = terminalUi();
    const outcome = await guide({ ui, state: stateRoot(), signal: controller.signal, now: Date.now, edit: openEditor,
      execute: async command => { if (validateArguments(command)) throw new Error('the guide runs commands only'); return dispatch(command, line => ui.note(line)); } });
    if (outcome.interrupted) process.exitCode = 130;
  } else {
    const result = await dispatch(args);
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  }
  if (controller.signal.aborted) process.exitCode = 130;
} catch (error) {
  console.error(JSON.stringify({ error: (error as Error).message, recovery: recoveryHint(args[0], (error as Error).message) })); process.exitCode = controller.signal.aborted ? 130 : 1;
}
