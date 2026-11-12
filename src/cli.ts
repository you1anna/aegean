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
import { recover } from './application/recovery.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const required = (name: string): string => { const value = flag(name); if (!value || value.startsWith('--')) throw new Error(`${name} is required`); return value; };
const optional = (name: string): string | undefined => args.includes(name) ? required(name) : undefined;
const repeated = (name: string): string[] => args.flatMap((arg, index) => {
  if (arg !== name) return [];
  const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return [value];
});
const controller = new AbortController();
process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
try {
  let result: unknown;
  switch (args[0]) {
    case 'doctor': result = await doctor(root); break;
    case 'qualify': result = await qualifyHost(root, stateRoot(), (await hostConfig()).host, controller.signal); break;
    case 'configure': result = await configure({ controlRemote: optional('--control-remote'), verifierCheckout: optional('--verifier-checkout'), image: optional('--image'), excludedRoots: repeated('--exclude') }); break;
    case 'accept-release': result = await acceptRelease(root, required('--manifest')); break;
    case 'enrol': result = await enrol(process.cwd(), flag('--config'), binaries(root).openspec, args.includes('--check')); break;
    case 'start': result = await start(root, process.cwd(), await readFile(required('--request'), 'utf8'), controller.signal); break;
    case 'resume': result = await resume(root, required('--run'), controller.signal); break;
    case 'status': result = await status(flag('--run')); break;
    case 'cancel': result = await cancel(required('--run')); break;
    case 'recover': result = await recover(required('--run'), args.includes('--confirm-stopped')); break;
    case 'activate-routing': case 'deactivate-routing': case 'migrate-routing': case 'recover-routing':
      result = await checked(process.execPath, [join(root, 'scripts/install.mjs'), `--${args[0]}`, ...repeated('--project').flatMap(value => ['--project', value]), ...repeated('--project-path').flatMap(value => ['--project-path', value])], { timeoutMs: 60000, signal: controller.signal }); break;
    case 'rollback': result = await checked(process.execPath, [join(root, 'scripts/install.mjs'), '--rollback'], { timeoutMs: 30000 }); break;
    case 'upgrade':
      result = await checked('/bin/sh', [join(resolve(required('--source')), 'scripts/bootstrap.sh')], { timeoutMs: 600000 }); break;
    case '--version': result = { version: packageInfo.version }; break;
    case undefined: case '--help': case 'help':
      console.log(`Aegean ${packageInfo.version} — bootstrap; full workflow requires acceptance\n\nCommands:\n  doctor --json\n  qualify  (record native prerequisites for this host; does not accept release)\n  configure --control-remote URL --verifier-checkout PATH --exclude PATH [--exclude PATH ...]\n  configure --exclude PATH [--exclude PATH ...]  (add exclusions to an existing host)\n  accept-release --manifest FILE\n  enrol --check | --config FILE\n  start --request FILE\n  status [--run ID]\n  resume --run ID\n  cancel --run ID\n  recover --run ID --confirm-stopped\n  upgrade --source PATH\n  rollback\n  activate-routing --project OWNER/REPO --project-path PATH [repeat pairs]\n  deactivate-routing | migrate-routing | recover-routing\n\nOperations: ${join(root, 'docs/OPERATIONS.md')}`); process.exit(0);
    default: throw new Error(`unknown command: ${args[0]}`);
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  if (controller.signal.aborted) process.exitCode = 130;
} catch (error) {
  console.error(JSON.stringify({ error: (error as Error).message, recovery: args[0] === 'configure' ? 'Inspect host configuration in the operations guide before retrying.' : 'Run aegean status and inspect the operations guide before retrying effects.' })); process.exitCode = controller.signal.aborted ? 130 : 1;
}
