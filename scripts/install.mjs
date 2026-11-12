import { mkdir, readFile, writeFile, cp, realpath, readlink, symlink, rename, lstat, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceProvenance } from './source-provenance.mjs';

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
  const provenance = sourceProvenance(repo);
  const pins = JSON.parse(await readFile(join(repo, 'toolchain.json'), 'utf8'));
  if (process.version !== 'v' + pins.node) throw new Error(`Expected Node ${pins.node}; use scripts/bootstrap.sh`);
  const claude = execFileSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim();
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' });
  if (!version.startsWith(pins.claude + ' ')) throw new Error(`Claude ${pins.claude} required; use the official native version installer before continuing`);
  const appVersion = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version;
  const release = join(releases, `${appVersion}-${provenance.sourceHash.slice(0, 12)}`);
  if (!(await exists(release))) {
    const build = await mkdtemp(join(tmpdir(), 'aegean-release-build-'));
    const staging = `${release}.staging-${randomUUID()}`; await mkdir(staging);
    try {
    // Build only the recorded commit in an empty directory. Ignored/stale dist
    // files in the caller's checkout cannot become installed executables.
    const archive = join(build, 'source.tar');
    execFileSync('git', ['archive', '--format=tar', '--output', archive, provenance.sourceCommit], { cwd: repo });
    execFileSync('tar', ['-xf', archive, '-C', build]); await rm(archive);
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: build, stdio: 'inherit' });
    execFileSync('npm', ['run', 'build'], { cwd: build, stdio: 'inherit' });
    const { treeDigest } = await import(pathToFileURL(join(build, 'dist/src/adapters/files.js')).href);
    const { releaseArtifacts, fileHash } = await import(pathToFileURL(join(build, 'dist/src/adapters/release-artifacts.js')).href);
    for (const name of ['dist', 'docs', 'skills', 'policy', 'scripts', 'toolchain.json', 'package.json', 'package-lock.json']) await cp(join(build, name), join(staging, name), { recursive: true });
    await mkdir(join(staging, 'tools'));
    for (const name of ['package.json', 'package-lock.json']) await cp(join(build, 'tools', name), join(staging, 'tools', name));
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staging, stdio: 'inherit' });
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(staging, 'tools'), stdio: 'inherit' });
    await mkdir(join(staging, 'bin')); await cp(await realpath(claude), join(staging, 'bin/claude'));
    const artifacts = await releaseArtifacts(staging);
    await writeFile(join(staging, 'artifact-manifest.json'), JSON.stringify(artifacts) + '\n');
    const artifactHash = createHash('sha256').update(JSON.stringify(artifacts)).digest('hex');
    await writeFile(join(staging, 'installation.json'), JSON.stringify({ schemaVersion: 2, ...provenance, buildHash: await treeDigest(join(staging, 'dist')), artifactHash, nodeHash: await fileHash(process.execPath), node: await realpath(process.execPath), pins }, null, 2) + '\n');
    await rename(staging, release);
    } finally { await rm(build, { recursive: true, force: true }); await rm(staging, { recursive: true, force: true }); }
  }
  await activate(release);
}
