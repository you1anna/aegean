import { mkdir, readFile, writeFile, cp, realpath, readlink, symlink, rename, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const userRoot = await realpath(resolve(flag('--user-root') ?? homedir()));
const data = join(userRoot, '.local/share/aegean');
const releases = join(data, 'releases');
const current = join(data, 'current');
const previous = join(data, 'previous');
const exists = async p => { try { await lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const link = async (target, path) => {
  if (await exists(path)) { const st = await lstat(path); if (!st.isSymbolicLink()) throw new Error(`Refusing to replace non-managed file: ${path}`); }
  const temp = `${path}.${randomUUID()}`; await symlink(target, temp); await rename(temp, path);
};
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
async function manageInstructions(path, routing) {
  const begin = '<!-- aegean:begin -->'; const end = '<!-- aegean:end -->';
  await mkdir(dirname(path), { recursive: true });
  const old = await exists(path) ? await readFile(path, 'utf8') : '';
  if ((old.includes(begin) || old.includes(end)) && !(old.indexOf(begin) >= 0 && old.indexOf(end) > old.indexOf(begin) && old.split(begin).length === 2 && old.split(end).length === 2)) throw new Error(`Malformed managed block: ${path}`);
  const block = `${begin}\n## Aegean engineering workflow\n\n${routing.trim()}\n${end}`;
  const next = old.includes(begin) ? old.slice(0, old.indexOf(begin)) + block + old.slice(old.indexOf(end) + end.length) : old.trimEnd() + '\n\n' + block + '\n';
  if (next === old) return;
  if (old) { const backup = join(data, 'config-backups', createHash('sha256').update(path + old).digest('hex') + '.md'); await mkdir(dirname(backup), { recursive: true, mode: 0o700 }); await writeFile(backup, old, { mode: 0o600 }); }
  const temp = `${path}.${randomUUID()}`; await writeFile(temp, next, { mode: 0o600 }); await rename(temp, path);
}
async function activate(release) {
  const manifest = JSON.parse(await readFile(join(release, 'installation.json'), 'utf8'));
  const routing = await readFile(join(release, 'policy/ROUTING.md'), 'utf8');
  await manageInstructions(join(userRoot, '.codex/AGENTS.md'), routing);
  await manageInstructions(join(userRoot, '.claude/CLAUDE.md'), routing);
  for (const parent of ['.agents/skills', '.claude/skills']) {
    await mkdir(join(userRoot, parent), { recursive: true });
    const dest = join(userRoot, parent, 'aegean');
    if (await exists(dest)) {
      const st = await lstat(dest);
      if (!st.isSymbolicLink() || !(await readlink(dest)).startsWith(data + '/')) throw new Error('Refusing to replace an existing unmanaged Aegean skill');
    }
    await link(join(current, 'skills/aegean'), dest);
  }
  await mkdir(join(userRoot, '.local/bin'), { recursive: true });
  const wrapper = join(userRoot, '.local/bin/aegean');
  if (await exists(wrapper) && !(await readFile(wrapper, 'utf8')).includes('# managed-by-aegean')) throw new Error('Existing aegean executable is not managed by this installer');
  await writeFile(wrapper, `#!/bin/sh\n# managed-by-aegean\nexec ${quote(manifest.node)} ${quote(join(current, 'dist/src/cli.js'))} "$@"\n`, { mode: 0o755 });
  const old = await exists(current) ? await readlink(current) : null;
  if (old && old !== release) await link(old, previous);
  await link(release, current);
  console.log(JSON.stringify({ installed: release, previous: old, fullWorkflowReady: false }));
}
await mkdir(releases, { recursive: true, mode: 0o700 });
if (args.includes('--rollback')) {
  const release = await realpath(previous);
  if (!release.startsWith(releases + '/')) throw new Error('Rollback target outside managed releases');
  await activate(release);
} else {
  const pins = JSON.parse(await readFile(join(repo, 'toolchain.json'), 'utf8'));
  if (process.version !== 'v' + pins.node) throw new Error(`Expected Node ${pins.node}; use scripts/bootstrap.sh`);
  const claude = execFileSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim();
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' });
  if (!version.startsWith(pins.claude + ' ')) throw new Error(`Claude ${pins.claude} required; use the official native version installer before continuing`);
  const hash = createHash('sha256');
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  for (const name of names) {
    const path = join(repo, name); const info = await lstat(path);
    hash.update(name).update('\0').update(info.isSymbolicLink() ? `symlink:${await readlink(path)}` : await readFile(path));
  }
  const fingerprint = hash.digest('hex');
  const release = join(releases, `0.1.0-${fingerprint.slice(0, 12)}`);
  if (!(await exists(release))) {
    const staging = `${release}.staging-${randomUUID()}`; await mkdir(staging);
    for (const name of ['dist', 'docs', 'skills', 'policy', 'scripts', 'toolchain.json', 'package.json', 'package-lock.json']) await cp(join(repo, name), join(staging, name), { recursive: true });
    await mkdir(join(staging, 'tools'));
    for (const name of ['package.json', 'package-lock.json']) await cp(join(repo, 'tools', name), join(staging, 'tools', name));
    execFileSync('npm', ['ci', '--prefix', staging, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
    execFileSync('npm', ['ci', '--prefix', join(staging, 'tools'), '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
    await mkdir(join(staging, 'bin')); await cp(await realpath(claude), join(staging, 'bin/claude'));
    await writeFile(join(staging, 'installation.json'), JSON.stringify({ schemaVersion: 1, sourceHash: fingerprint, node: await realpath(process.execPath), pins }, null, 2) + '\n');
    await rename(staging, release);
  }
  await activate(release);
}
