import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checked } from '../src/adapters/process.js';
import { eligible } from '../src/application/enrol.js';
import { assertArchiveOnly } from '../src/application/archive.js';
import { HostSchema } from '../src/application/runtime.js';
import { syntheticAcceptance } from './helpers/acceptance.js';
import toolchain from '../toolchain.json' with { type: 'json' };

const routing = await import(pathToFileURL(resolve('scripts/routing.mjs')).href);
type RoutingFixture = { user: string; data: string; state: string; current: string; previous: string; host: string; project: string; projects: { repository: string; path: string }[]; codex: string; claude: string };
async function routingFixture(body: (fixture: RoutingFixture) => Promise<void>): Promise<void> {
  const user = await realpath(await mkdtemp(join(tmpdir(), 'aegean-routing-test-')));
  const data = join(user, '.local/share/aegean'); const state = join(user, '.local/state/aegean'); const host = randomUUID();
  try {
    for (const name of ['v1', 'v2']) {
      const root = join(data, 'releases', name);
      // Synthetic installed modules delegate to the actual compiled adapters;
      // the fixture helper seals these files and records test-only evidence.
      for (const name of ['adapters/acceptance.js', 'adapters/candidate-git.js', 'application/runtime.js', 'application/enrol.js', 'domain/config.js']) {
        const path = join(root, 'dist/src', name); await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `export * from ${JSON.stringify(pathToFileURL(resolve('dist/src', name)).href)};\n`);
      }
      await mkdir(join(root, 'policy')); await writeFile(join(root, 'policy/ROUTING.md'), await readFile('policy/ROUTING.md'));
      await mkdir(join(root, 'skills/aegean'), { recursive: true }); await writeFile(join(root, 'skills/aegean/SKILL.md'), 'Synthetic skill fixture\n');
      await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' })); await writeFile(join(root, 'release-name'), name);
      await syntheticAcceptance(root, state, host);
      const manifest = JSON.parse(await readFile(join(root, 'installation.json'), 'utf8'));
      await writeFile(join(root, 'installation.json'), JSON.stringify({ ...manifest, node: process.execPath }));
    }
    const current = join(data, 'releases/v2'); const previous = join(data, 'releases/v1');
    await symlink(current, join(data, 'current')); await symlink(previous, join(data, 'previous'));
    await writeFile(join(state, 'settings.json'), JSON.stringify({ schemaVersion: 1, host, controlRemote: 'git@github.com:fixture/control.git', verifierCheckout: join(user, 'verifier'), excludedRoots: [join(user, 'excluded')], billingConfirmed: true }));
    const project = join(user, 'project'); await mkdir(project);
    const git = (args: string[]) => checked('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: project });
    await git(['init', '-b', 'main']); await git(['config', 'user.name', 'Fixture']); await git(['config', 'user.email', 'fixture@localhost']);
    await git(['remote', 'add', 'origin', 'git@github.com:fixture/project.git']);
    await writeFile(join(project, 'aegean.json'), JSON.stringify({ schemaVersion: 2, standardVersion: toolchain.policy, repository: 'fixture/project', approver: { id: 1, login: 'fixture' }, approvalMode: 'local', checks: [['node', 'app.js']], verifier: { kind: 'cli', image: toolchain.verifier.image, command: ['node', 'app.js'] } }) + '\n');
    await git(['add', 'aegean.json']); await git(['commit', '-m', 'reviewed project policy']);
    const codex = join(user, '.codex/AGENTS.md'); const claude = join(user, '.claude/CLAUDE.md');
    for (const path of [codex, claude]) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'Unrelated important rule.\n'); }
    await body({ user, data, state, current, previous, host, project, projects: [{ repository: 'fixture/project', path: project }], codex, claude });
  } finally { await rm(user, { recursive: true, force: true }); }
}

test('a string cannot impersonate operator billing acknowledgement', () => {
  const config = { schemaVersion: 1, host: '267fd10d-f2ff-4ac5-bb8c-71e4564b14e4', controlRemote: 'git@github.com:owner/verifier.git', verifierCheckout: '/private/verifier', image: 'node@sha256:' + 'a'.repeat(64), billingConfirmed: false };
  assert.equal(HostSchema.parse(config).billingConfirmed, false);
  assert.throws(() => HostSchema.parse({ ...config, billingConfirmed: 'false' }));
});

test('automatic post-merge archival cannot publish implementation changes', () => {
  assert.doesNotThrow(() => assertArchiveOnly(['openspec/specs/api/spec.md', 'openspec/changes/archive/date-change/proposal.md']));
  assert.throws(() => assertArchiveOnly(['openspec/specs/api/spec.md', 'src/app.ts']), /implementation/);
  assert.throws(() => assertArchiveOnly([]), /implementation/);
});

test('ordinary release selection and rollback preserve global files byte-for-byte and report legacy migration', async () => routingFixture(async f => {
  const legacy = 'Unrelated important rule.\n\n<!-- aegean:begin -->\nLegacy mandatory routing\n<!-- aegean:end -->\n';
  await writeFile(f.codex, legacy);
  const result = JSON.parse(await checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', f.user]));
  assert.equal(await readlink(join(f.data, 'current')), f.previous); assert.equal(await readlink(join(f.data, 'previous')), f.current);
  assert.equal(await readFile(f.codex, 'utf8'), legacy); assert.equal(await readFile(f.claude, 'utf8'), 'Unrelated important rule.\n');
  assert.equal(result.migrationRequired, true); assert.equal(result.routingActive, false);
  assert.equal(await readlink(join(f.user, '.agents/skills/aegean')), join(f.data, 'current/skills/aegean'));
  await assert.rejects(access(join(f.data, 'routing.json'))); await assert.rejects(access(join(f.data, 'config-backups')));
}));

test('explicit scoped activation binds accepted host, release, capability and committed project policy', async () => routingFixture(async f => {
  const args = [resolve('scripts/install.mjs'), '--activate-routing', '--project', 'fixture/project', '--project-path', f.project, '--user-root', f.user];
  assert.equal(JSON.parse(await checked(process.execPath, args)).changed, true);
  const active = JSON.parse(await readFile(join(f.data, 'routing.json'), 'utf8'));
  assert.equal(active.host, f.host); assert.equal(active.release, f.current); assert.equal(active.capability, 'bounded-cli-v1');
  assert.equal(active.projects[0].repository, 'fixture/project'); assert.equal(active.projects[0].path, f.project);
  assert.match(active.projects[0].policyHash, /^[a-f0-9]{64}$/); assert.match(active.identity.policyIdentity, /^[a-f0-9]{64}$/);
  for (const path of [f.codex, f.claude]) {
    const content = await readFile(path, 'utf8'); assert.ok(content.startsWith('Unrelated important rule.\n'));
    assert.match(content, /fixture\/project/); assert.match(content, /only these exact local checkouts/); assert.equal(content.split('<!-- aegean:begin -->').length, 2);
  }
  assert.equal(JSON.parse(await checked(process.execPath, args)).changed, false);
  assert.ok((await readdir(join(f.data, 'config-backups'))).length >= 3);
}));

test('activation refuses unaccepted hosts and releases without modifying instructions', async () => routingFixture(async f => {
  const gate = await readFile(join(f.state, 'acceptance.json'), 'utf8'); await rm(join(f.state, 'acceptance.json'));
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /ENOENT|acceptance/);
  await writeFile(join(f.state, 'acceptance.json'), gate);
  const config = JSON.parse(await readFile(join(f.state, 'settings.json'), 'utf8'));
  await writeFile(join(f.state, 'settings.json'), JSON.stringify({ ...config, host: randomUUID() }));
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /host/);
  await writeFile(join(f.state, 'settings.json'), JSON.stringify(config));
  await writeFile(join(f.current, 'drifted-artifact'), 'changed');
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /artifacts/);
  assert.equal(await readFile(f.codex, 'utf8'), 'Unrelated important rule.\n'); await assert.rejects(access(join(f.data, 'routing.json')));
}));

test('repeated explicit project and path options activate only matching reviewed repositories', async () => routingFixture(async f => {
  const second = join(f.user, 'second'); await mkdir(second);
  const config = JSON.parse(await readFile(join(f.project, 'aegean.json'), 'utf8')); config.repository = 'fixture/second';
  await writeFile(join(second, 'aegean.json'), JSON.stringify(config));
  const git = (args: string[]) => checked('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: second });
  await git(['init', '-b', 'main']); await git(['config', 'user.name', 'Fixture']); await git(['config', 'user.email', 'fixture@localhost']);
  await git(['remote', 'add', 'origin', 'https://github.com/fixture/second.git']); await git(['add', 'aegean.json']); await git(['commit', '-m', 'reviewed second project policy']);
  await checked(process.execPath, [resolve('scripts/install.mjs'), '--activate-routing', '--project', 'fixture/project', '--project-path', f.project, '--project', 'fixture/second', '--project-path', second, '--user-root', f.user]);
  const active = JSON.parse(await readFile(join(f.data, 'routing.json'), 'utf8'));
  assert.deepEqual(active.projects.map((project: { repository: string }) => project.repository), ['fixture/project', 'fixture/second']);
  assert.match(await readFile(f.codex, 'utf8'), /fixture\/second/);
}));

test('activation refuses arbitrary project names, uncommitted policy, excluded paths and duplicate projects', async () => routingFixture(async f => {
  await assert.rejects(routing.routingAction(f.user, 'activate', [{ repository: 'different/project', path: f.project }]), /origin/);
  const policy = await readFile(join(f.project, 'aegean.json'), 'utf8'); await writeFile(join(f.project, 'aegean.json'), policy + ' ');
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /committed|policy/); await writeFile(join(f.project, 'aegean.json'), policy);
  await assert.rejects(routing.routingAction(f.user, 'activate', [...f.projects, ...f.projects]), /duplicate/);
  const config = JSON.parse(await readFile(join(f.state, 'settings.json'), 'utf8'));
  await writeFile(join(f.state, 'settings.json'), JSON.stringify({ ...config, excludedRoots: [f.project] }));
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /excluded/);
  assert.equal(await readFile(f.codex, 'utf8'), 'Unrelated important rule.\n');
}));

test('deactivation removes only its block, restores missing files and preserves later unrelated edits', async () => routingFixture(async f => {
  await rm(f.claude); await routing.routingAction(f.user, 'activate', f.projects);
  await writeFile(f.codex, (await readFile(f.codex, 'utf8')) + '\nA later unrelated instruction.\n');
  assert.equal((await routing.routingAction(f.user, 'deactivate')).changed, true);
  assert.equal(await readFile(f.codex, 'utf8'), 'Unrelated important rule.\n\nA later unrelated instruction.\n');
  await assert.rejects(access(f.claude)); await assert.rejects(access(join(f.data, 'routing.json')));
  assert.equal((await routing.routingAction(f.user, 'deactivate')).changed, false);
}));

test('legacy migration is explicit, backed up and repeatable without requiring acceptance', async () => routingFixture(async f => {
  const old = 'Keep before\n<!-- aegean:begin -->\nLegacy required workflow\n<!-- aegean:end -->\nKeep after\n'; await writeFile(f.codex, old);
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /migrate-routing/);
  await assert.rejects(routing.routingAction(f.user, 'deactivate'), /migrate-routing/);
  await rm(join(f.state, 'acceptance.json'));
  assert.equal((await routing.routingAction(f.user, 'migrate')).changed, true);
  assert.equal(await readFile(f.codex, 'utf8'), 'Keep before\n\nKeep after\n');
  assert.equal((await routing.routingAction(f.user, 'migrate')).changed, false);
  const backups = await readdir(join(f.data, 'config-backups'));
  assert.ok((await Promise.all(backups.map(name => readFile(join(f.data, 'config-backups', name), 'utf8')))).some(content => JSON.parse(content).state.content === old));
}));

test('routing refuses malformed blocks, symlink targets and symlink parents without outside writes', async () => routingFixture(async f => {
  await writeFile(f.codex, '<!-- aegean:begin -->\nBroken block\n');
  await assert.rejects(routing.routingAction(f.user, 'migrate'), /malformed/);
  const outside = join(f.user, 'outside'); await writeFile(outside, 'outside sentinel\n'); await rm(f.codex); await symlink(outside, f.codex);
  await assert.rejects(routing.routingAction(f.user, 'migrate'), /regular|symlink/);
  await rm(join(f.user, '.codex'), { recursive: true }); await mkdir(join(f.user, 'elsewhere')); await symlink(join(f.user, 'elsewhere'), join(f.user, '.codex'));
  await assert.rejects(routing.routingAction(f.user, 'migrate'), /symlink/);
  assert.equal(await readFile(outside, 'utf8'), 'outside sentinel\n'); assert.deepEqual(await readdir(join(f.user, 'elsewhere')), []);
}));

test('interrupted multi-file routing edits recover exact old state or the fully completed result', async () => {
  for (const failureAt of ['codex', 'claude', 'metadata']) await routingFixture(async f => {
    await assert.rejects(routing.routingAction(f.user, 'activate', f.projects, { checkpoint: async (id: string) => { if (id === failureAt) throw new Error('synthetic interruption'); } }), /synthetic interruption/);
    await access(join(f.data, 'routing-transaction.json'));
    await assert.rejects(checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', f.user]), /unfinished routing/);
    assert.equal((await routing.routingAction(f.user, 'recover')).recovered, true);
    await assert.rejects(access(join(f.data, 'routing-transaction.json')));
    if (failureAt === 'metadata') { await access(join(f.data, 'routing.json')); assert.match(await readFile(f.codex, 'utf8'), /explicitly activated/); }
    else { await assert.rejects(access(join(f.data, 'routing.json'))); assert.equal(await readFile(f.codex, 'utf8'), 'Unrelated important rule.\n'); assert.equal(await readFile(f.claude, 'utf8'), 'Unrelated important rule.\n'); }
    assert.equal((await routing.routingAction(f.user, 'recover')).recovered, false);
  });
});

test('routing recovery refuses third-state edits and preserves every file and the transaction', async () => routingFixture(async f => {
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects, { checkpoint: async () => { throw new Error('synthetic interruption'); } }));
  const first = await readFile(f.codex, 'utf8'); await writeFile(f.claude, 'Human edit after interruption\n');
  await assert.rejects(routing.routingAction(f.user, 'recover'), /third state/);
  assert.equal(await readFile(f.codex, 'utf8'), first); assert.equal(await readFile(f.claude, 'utf8'), 'Human edit after interruption\n');
  await access(join(f.data, 'routing-transaction.json'));
}));

test('routing mutations serialize and explicit recovery refuses a live owner but recovers a stopped owner', async () => routingFixture(async f => {
  const context = await routing.routingContext(f.user);
  await routing.withInstallationLock(context, async () => {
    await assert.rejects(routing.routingAction(f.user, 'migrate'), /locked/);
    await assert.rejects(routing.routingAction(f.user, 'recover'), /still alive/);
  });
  const stoppedPid = Number(await checked(process.execPath, ['-e', 'console.log(process.pid)']));
  await writeFile(join(f.data, 'installation-lock/owner.json'), JSON.stringify({ pid: stoppedPid, token: randomUUID() }));
  assert.equal((await routing.routingAction(f.user, 'recover')).recovered, false);
  await assert.rejects(access(join(f.data, 'installation-lock/owner.json')));
}));

test('ordinary install checks refuse drifted active policy and explicit migration can remove a reviewed edited block', async () => routingFixture(async f => {
  await routing.routingAction(f.user, 'activate', f.projects); const context = await routing.routingContext(f.user);
  await checked('git', ['commit', '--allow-empty', '-m', 'ordinary code change'], { cwd: f.project });
  assert.equal((await routing.assertRoutingAllowsSelection(context, f.current)).routingActive, true);
  const config = JSON.parse(await readFile(join(f.project, 'aegean.json'), 'utf8')); config.checks = [['node', 'changed.js']];
  await writeFile(join(f.project, 'aegean.json'), JSON.stringify(config)); await checked('git', ['add', 'aegean.json'], { cwd: f.project }); await checked('git', ['commit', '-m', 'changed project policy'], { cwd: f.project });
  await assert.rejects(routing.assertRoutingAllowsSelection(context, f.current), /policy changed/);
  await writeFile(f.codex, (await readFile(f.codex, 'utf8')).replace('explicitly activated scope', 'reviewed manual edit'));
  await assert.rejects(routing.routingAction(f.user, 'deactivate'), /differ/);
  await routing.routingAction(f.user, 'migrate');
  assert.doesNotMatch(await readFile(f.codex, 'utf8'), /aegean:begin|reviewed manual edit/); await assert.rejects(access(join(f.data, 'routing.json')));
}));

test('active routing blocks rollback until explicit deactivation and unaccepted target cannot reactivate', async () => routingFixture(async f => {
  await routing.routingAction(f.user, 'activate', f.projects); const original = await readFile(f.codex, 'utf8');
  await assert.rejects(checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', f.user]), /deactivate-routing/);
  assert.equal(await readlink(join(f.data, 'current')), f.current); assert.equal(await readFile(f.codex, 'utf8'), original);
  await routing.routingAction(f.user, 'deactivate'); await checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', f.user]);
  assert.equal(await readlink(join(f.data, 'current')), f.previous); await assert.rejects(access(join(f.data, 'routing.json')));
  await assert.rejects(routing.routingAction(f.user, 'activate', f.projects), /stale|identity/);
  assert.equal(await readFile(f.codex, 'utf8'), 'Unrelated important rule.\n');
}));

test('installer refuses unmanaged executable destinations and tampered rollback artifacts before selecting', async () => routingFixture(async f => {
  await mkdir(join(f.user, '.local/bin')); await writeFile(join(f.user, '.local/bin/aegean'), '#!/bin/sh\necho mine\n');
  await assert.rejects(checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', f.user]), /not managed/);
  assert.equal(await readlink(join(f.data, 'current')), f.current);
  await rm(join(f.user, '.local/bin/aegean')); await writeFile(join(f.previous, 'tampered'), 'unaccepted');
  await assert.rejects(checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', f.user]), /artifacts/);
  assert.equal(await readlink(join(f.data, 'current')), f.current);
}));
test('sensitive and production checkouts cannot be auto-enrolled', () => {
  const excluded = ['/tmp/private-project'];
  for (const path of ['/tmp/private-project', '/tmp/private-project/child', '/srv/app']) assert.throws(() => eligible(path, excluded), /excluded/);
  assert.doesNotThrow(() => eligible('/tmp/ordinary-project', excluded));
  assert.throws(() => eligible('/tmp/ordinary-project', ['/']), /excluded/);
  assert.throws(() => eligible('/tmp/ordinary-project'), /fails closed/);
});
test('domain modules do not depend on process, persistence or orchestration adapters', async () => {
  for (const name of await readdir('src/domain')) {
    const source = await readFile(join('src/domain', name), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(application|adapters|node:fs|node:child_process|node:http)/);
  }
});
