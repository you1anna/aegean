#!/usr/bin/env node
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { doctor, configure, binaries, acceptRelease } from './application/runtime.js';
import packageInfo from '../package.json' with { type: 'json' };
import { enrol } from './application/enrol.js';
import { start, resume, status, cancel } from './application/engine.js';
import { checked } from './adapters/process.js';
import { recover } from './application/recovery.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const required = (name: string): string => { const value = flag(name); if (!value || value.startsWith('--')) throw new Error(`${name} is required`); return value; };
const controller = new AbortController();
process.on('SIGINT', () => controller.abort()); process.on('SIGTERM', () => controller.abort());
try {
  let result: unknown;
  switch (args[0]) {
    case 'doctor': result = await doctor(root); break;
    case 'configure': result = await configure(required('--control-remote'), resolve(required('--verifier-checkout')), flag('--image')); break;
    case 'accept-release': result = await acceptRelease(root, required('--manifest')); break;
    case 'enrol': result = await enrol(process.cwd(), flag('--config'), binaries(root).openspec, args.includes('--check')); break;
    case 'start': result = await start(root, process.cwd(), await readFile(required('--request'), 'utf8'), controller.signal); break;
    case 'resume': result = await resume(root, required('--run'), controller.signal); break;
    case 'status': result = await status(flag('--run')); break;
    case 'cancel': result = await cancel(required('--run')); break;
    case 'recover': result = await recover(required('--run'), args.includes('--confirm-stopped')); break;
    case 'rollback': result = await checked(process.execPath, [join(root, 'scripts/install.mjs'), '--rollback'], { timeoutMs: 30000 }); break;
    case 'upgrade':
      result = await checked('/bin/sh', [join(resolve(required('--source')), 'scripts/bootstrap.sh')], { timeoutMs: 600000 }); break;
    case '--version': result = { version: packageInfo.version }; break;
    case undefined: case '--help': case 'help':
      console.log(`Aegean ${packageInfo.version} — bootstrap; full workflow requires acceptance\n\nCommands:\n  doctor --json\n  configure --control-remote URL --verifier-checkout PATH\n  accept-release --manifest FILE\n  enrol --check | --config FILE\n  start --request FILE\n  status [--run ID]\n  resume --run ID\n  cancel --run ID\n  recover --run ID --confirm-stopped\n  upgrade --source PATH\n  rollback\n\nOperations: ${join(root, 'docs/OPERATIONS.md')}`); process.exit(0);
    default: throw new Error(`unknown command: ${args[0]}`);
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  if (controller.signal.aborted) process.exitCode = 130;
} catch (error) {
  console.error(JSON.stringify({ error: (error as Error).message, recovery: 'Run aegean status and inspect the operations guide before retrying effects.' })); process.exitCode = controller.signal.aborted ? 130 : 1;
}
