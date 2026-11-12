import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checked } from '../src/adapters/process.js';
import { eligible } from '../src/application/enrol.js';
import { assertArchiveOnly } from '../src/application/archive.js';
import { HostSchema } from '../src/application/runtime.js';

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

test('rollback switches release and preserves unrelated global instructions', async () => {
  const user = await realpath(await mkdtemp(join(tmpdir(), 'aegean-install-test-')));
  try {
    const data = join(user, '.local/share/aegean');
    for (const name of ['v1', 'v2']) {
      const release = join(data, 'releases', name); await mkdir(join(release, 'policy'), { recursive: true });
      await mkdir(join(release, 'skills/aegean'), { recursive: true });
      await writeFile(join(release, 'policy/ROUTING.md'), `Policy ${name}\n`);
      await writeFile(join(release, 'installation.json'), JSON.stringify({ node: process.execPath }));
    }
    await symlink(join(data, 'releases/v1'), join(data, 'previous'));
    await symlink(join(data, 'releases/v2'), join(data, 'current'));
    await mkdir(join(user, '.codex')); await writeFile(join(user, '.codex/AGENTS.md'), 'Unrelated important rule.\n');
    await checked(process.execPath, [resolve('scripts/install.mjs'), '--rollback', '--user-root', user]);
    assert.equal(await readlink(join(data, 'current')), join(data, 'releases/v1'));
    assert.equal(await readlink(join(data, 'previous')), join(data, 'releases/v2'));
    assert.match(await readFile(join(user, '.codex/AGENTS.md'), 'utf8'), /Unrelated important rule\.[\s\S]*Policy v1/);
    assert.equal(await readlink(join(user, '.agents/skills/aegean')), join(data, 'current/skills/aegean'));
    assert.ok((await readdir(join(data, 'config-backups'))).length > 0);
  } finally { await rm(user, { recursive: true, force: true }); }
});
test('sensitive and production checkouts cannot be auto-enrolled', () => {
  const excluded = ['/tmp/private-project'];
  for (const path of ['/tmp/private-project', '/tmp/private-project/child', '/srv/app']) assert.throws(() => eligible(path, excluded), /excluded/);
  assert.doesNotThrow(() => eligible('/tmp/ordinary-project', excluded));
  assert.throws(() => eligible('/tmp/ordinary-project'), /fails closed/);
});
test('domain modules do not depend on process, persistence or orchestration adapters', async () => {
  for (const name of await readdir('src/domain')) {
    const source = await readFile(join('src/domain', name), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(application|adapters|node:fs|node:child_process|node:http)/);
  }
});
