import { mkdir, readFile, writeFile, cp, realpath, readlink, symlink, rename, lstat, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchesVersion, reportedVersion } from './cli-version.mjs';
import { ensureDocker } from './docker-client.mjs';
import { assertNoUninstall } from './uninstall-core.mjs';
import { sourceProvenance } from './source-provenance.mjs';
import { assertRoutingAllowsSelection, managedRelease, routingAction, routingContext, safeParents, validateInstalledRelease, withInstallationLock } from './routing.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const userRoot = await realpath(resolve(flag('--user-root') ?? homedir()));
await assertNoUninstall(userRoot);
const data = join(userRoot, '.local/share/aegean');
const releases = join(data, 'releases');
const current = join(data, 'current');
const previous = join(data, 'previous');
const routingFlags = ['--activate-routing', '--deactivate-routing', '--migrate-routing', '--recover-routing'];
const requestedRouting = routingFlags.filter(name => args.includes(name));
if (requestedRouting.length > 1 || (requestedRouting.length && args.includes('--rollback'))) throw new Error('Choose one installer or explicit routing action');
for (let i = 0; i < args.length; i++) {
  if (['--user-root', '--project', '--project-path'].includes(args[i])) { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`); i++; }
  else if (!['--rollback', ...routingFlags].includes(args[i])) throw new Error(`Unknown installer option: ${args[i]}`);
}
if (requestedRouting.length) {
  const values = name => args.flatMap((item, i) => item === name ? [args[i + 1]] : []);
  const projects = values('--project'); const paths = values('--project-path');
  const action = requestedRouting[0].slice(2).replace('-routing', '');
  if (projects.length !== paths.length || (action !== 'activate' && projects.length)) throw new Error('Activation requires paired --project owner/repo and --project-path PATH; other routing actions take no projects');
  console.log(JSON.stringify(await routingAction(userRoot, action, projects.map((repository, i) => ({ repository, path: paths[i] })))));
  process.exit(0);
}
if (args.includes('--project') || args.includes('--project-path')) throw new Error('Projects are only valid with --activate-routing');
const exists = async p => { try { await lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const link = async (target, path) => {
  if (await exists(path)) { const st = await lstat(path); if (!st.isSymbolicLink()) throw new Error(`Refusing to replace non-managed file: ${path}`); }
  const temp = `${path}.${randomUUID()}`; await symlink(target, temp); await rename(temp, path);
};
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
async function selectRelease(release) {
  const context = await routingContext(userRoot); release = await managedRelease(context, release);
  await validateInstalledRelease(release);
  return withInstallationLock(context, async () => {
  await assertNoUninstall(userRoot);
  const routing = await assertRoutingAllowsSelection(context, release);
  const manifest = JSON.parse(await readFile(join(release, 'installation.json'), 'utf8'));
  if (await realpath(manifest.node) !== await realpath(process.execPath)) throw new Error('Selected release Node path differs from its verified runtime');
  for (const name of ['current', 'previous']) if (await exists(join(data, name))) {
    if (!(await lstat(join(data, name))).isSymbolicLink()) throw new Error(`Refusing unmanaged release pointer: ${name}`);
    await managedRelease(context, await realpath(join(data, name)));
  }
  // Validate every managed destination before changing any executable or link.
  for (const parent of ['.agents/skills', '.claude/skills']) {
    const dest = join(userRoot, parent, 'aegean');
    await safeParents(userRoot, dest, true);
    if (await exists(dest)) {
      const st = await lstat(dest);
      if (!st.isSymbolicLink() || !resolve(dirname(dest), await readlink(dest)).startsWith(data + '/')) throw new Error('Refusing to replace an existing unmanaged Aegean skill');
    }
  }
  const wrapper = join(userRoot, '.local/bin/aegean');
  await safeParents(userRoot, wrapper, true);
  if (await exists(wrapper)) {
    const info = await lstat(wrapper);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192 || !(await readFile(wrapper, 'utf8')).startsWith('#!/bin/sh\n# managed-by-aegean\n')) throw new Error('Existing aegean executable is not managed by this installer');
  }
  for (const parent of ['.agents/skills', '.claude/skills']) await link(join(current, 'skills/aegean'), join(userRoot, parent, 'aegean'));
  const temporary = `${wrapper}.${randomUUID()}`;
  await writeFile(temporary, `#!/bin/sh\n# managed-by-aegean\nPATH=${quote(join(current, 'bin/docker-client'))}:"$PATH"\nexport PATH\nexec ${quote(manifest.node)} ${quote(join(current, 'dist/src/cli.js'))} "$@"\n`, { mode: 0o755 }); await rename(temporary, wrapper);
  const old = await exists(current) ? await readlink(current) : null;
  if (old && old !== release) await link(old, previous);
  await link(release, current);
  console.log(JSON.stringify({ installed: release, previous: old, fullWorkflowReady: false, ...routing, ...(routing.migrationRequired ? { routingAction: 'Existing mandatory blocks were preserved. Review and run --migrate-routing; activation is a separate explicit accepted-host/project action.' } : {}) }));
  });
}
await safeParents(userRoot, join(releases, 'placeholder'), true);
if (args.includes('--rollback')) {
  const release = await realpath(previous);
  if (!release.startsWith(releases + '/')) throw new Error('Rollback target outside managed releases');
  await selectRelease(release);
} else {
  const provenance = sourceProvenance(repo);
  const pins = JSON.parse(await readFile(join(repo, 'toolchain.json'), 'utf8'));
  if (process.version !== 'v' + pins.node) throw new Error(`Expected Node ${pins.node}; use scripts/bootstrap.sh`);
  const claude = execFileSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim();
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' });
  if (!matchesVersion(version, pins.claude)) throw new Error(`Claude ${pins.claude} required; found ${version.trim()}. Update Claude with its official installer.`);
  const dockerClient = await ensureDocker(userRoot, pins.verifier);
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
    for (const name of ['dist', 'docs', 'examples', 'skills', 'policy', 'scripts', 'toolchain.json', 'package.json', 'package-lock.json']) await cp(join(build, name), join(staging, name), { recursive: true });
    await mkdir(join(staging, 'tools'));
    for (const name of ['package.json', 'package-lock.json']) await cp(join(build, 'tools', name), join(staging, 'tools', name));
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staging, stdio: 'inherit' });
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(staging, 'tools'), stdio: 'inherit' });
    await mkdir(join(staging, 'bin')); await cp(await realpath(claude), join(staging, 'bin/claude'));
    const copiedVersion = execFileSync(join(staging, 'bin/claude'), ['--version'], { encoding: 'utf8' });
    if (!matchesVersion(copiedVersion, pins.claude)) throw new Error('Copied Claude binary does not satisfy the compatibility requirement; retry installation');
    await writeFile(join(staging, 'tool-versions.json'), JSON.stringify({ claude: reportedVersion(copiedVersion) }) + '\n');
    await mkdir(join(staging, 'bin/docker-client'));
    await cp(dockerClient, join(staging, 'bin/docker-client/docker'));
    const artifacts = await releaseArtifacts(staging);
    await writeFile(join(staging, 'artifact-manifest.json'), JSON.stringify(artifacts) + '\n');
    const artifactHash = createHash('sha256').update(JSON.stringify(artifacts)).digest('hex');
    await writeFile(join(staging, 'installation.json'), JSON.stringify({ schemaVersion: 2, ...provenance, buildHash: await treeDigest(join(staging, 'dist')), artifactHash, nodeHash: await fileHash(process.execPath), node: await realpath(process.execPath), pins }, null, 2) + '\n');
    await rename(staging, release);
    } finally { await rm(build, { recursive: true, force: true }); await rm(staging, { recursive: true, force: true }); }
  }
  await selectRelease(release);
}
