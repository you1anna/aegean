import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { codexPolicy } from '../dist/src/adapters/agents.js';
import { command } from '../dist/src/adapters/process.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const temp = await mkdtemp('/private/tmp/aegean-builder-probe-');
const work = join(temp, 'work'); const secret = join(temp, 'private-sentinel');
try {
  await mkdir(work); await writeFile(secret, 'synthetic-private-canary');
  await symlink(secret, join(work, 'escape'));
  await writeFile(join(work, 'probe.mjs'), `
import fs from 'node:fs';
const denied = p => { try { fs.readFileSync(p); return false; } catch (e) { return ['EPERM','EACCES'].includes(e.code); } };
fs.writeFileSync('allowed.txt', 'ok');
console.log(JSON.stringify({workspaceWrite:fs.readFileSync('allowed.txt','utf8')==='ok',outsideReadDenied:denied(${JSON.stringify(secret)}),symlinkReadDenied:denied('escape')}));
`);
  const args = ['sandbox', '-P', 'aegean-builder', ...await codexPolicy(work, root), '-C', work, '--', process.execPath, 'probe.mjs'];
  const result = await command(join(root, 'tools/node_modules/.bin/codex'), args, { cwd: work, timeoutMs: 30000 });
  if (result.code !== 0) { console.error(result.stderr); process.exitCode = 1; }
  else {
    const checks = JSON.parse(result.stdout); console.log(JSON.stringify(checks));
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  }
} finally { await rm(temp, { recursive: true, force: true }); }
