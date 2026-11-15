import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GitLedger, emptyLedger } from '../src/adapters/ledger.js';
import { checked, command } from '../src/adapters/process.js';
import { acquireRunPermit, quiescentResources, reconcilePermitIntent, releaseQuiescentPermits } from '../src/application/ownership.js';
import { createRun, digest, POLICY } from '../src/domain/workflow.js';

const makeRun = (id = 'run-a', repository = 'owner/a', host = 'air') => createRun(id, host, repository, POLICY.version, 1, { approver: { id: 1, login: 'operator' }, projectPolicy: digest('reviewed policy') });
async function fixture(body: (f: { root: string; dir: string; remote: string; ledger: GitLedger; local: { id: string; generation: number; note: string } }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'aegean-ownership-test-')); const dir = join(root, 'local'); const remote = join(root, 'remote.git'); const seed = join(root, 'seed');
  try {
    await mkdir(dir); await mkdir(seed); await checked('git', ['init', '--bare', remote]); await checked('git', ['init', '-b', 'control'], { cwd: seed });
    await writeFile(join(seed, 'control.json'), JSON.stringify(emptyLedger())); await checked('git', ['add', 'control.json'], { cwd: seed });
    await checked('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'seed'], { cwd: seed }); await checked('git', ['push', remote, 'control'], { cwd: seed });
    const ledger = new GitLedger(remote); const initial = await ledger.acquire(makeRun());
    const local = { id: 'run-a', generation: initial.owners['run-a']!.generation, note: 'preserved local metadata' };
    await writeFile(join(dir, 'run.json'), JSON.stringify(local)); await body({ root, dir, remote, ledger, local });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

test('permit acquisition is idempotent and a held permit does not rewrite the local checkpoint', async () => fixture(async f => {
  const before = await readFile(join(f.dir, 'run.json'), 'utf8'); const revision = (await f.ledger.read()).revision;
  await acquireRunPermit(f.ledger, f.dir, f.local, 'air');
  assert.equal((await f.ledger.read()).revision, revision); assert.equal(await readFile(join(f.dir, 'run.json'), 'utf8'), before);
  await releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air'); await acquireRunPermit(f.ledger, f.dir, f.local, 'air');
  assert.ok(f.local.generation > 1); assert.deepEqual(await read(join(f.dir, 'run.json')), f.local); assert.equal(await read(join(f.dir, 'permit-intent.json')), null);
}));

test('lost grant response reconciles the exact remote generation and preserves unrelated capacity', async () => fixture(async f => {
  await f.ledger.releasePermits(f.local.id, 'air', f.local.generation); let uncertain = false;
  const lossy = new GitLedger(f.remote, async (file, args, options) => {
    if (uncertain && args.includes('fetch')) return { code: 1, stdout: '', stderr: 'synthetic fetch unavailable', durationMs: 0, interrupted: false };
    const result = await command(file, args, options);
    if (args.includes('push') && result.code === 0) {
      uncertain = true; await f.ledger.acquire(makeRun('run-b', 'owner/b', 'mini'));
      return { ...result, code: 1, stderr: 'synthetic response lost' };
    }
    return result;
  });
  await assert.rejects(acquireRunPermit(lossy, f.dir, f.local, 'air'), /not confirmed/);
  const remote = await f.ledger.read(); const grant = remote.owners[f.local.id]!.generation;
  assert.equal(f.local.generation, 1); assert.equal((await read(join(f.dir, 'run.json'))).generation, 1);
  assert.ok(await read(join(f.dir, 'permit-intent.json')));
  await reconcilePermitIntent(f.ledger, f.dir, f.local, 'air');
  assert.equal(f.local.generation, grant); assert.deepEqual(await read(join(f.dir, 'run.json')), f.local); assert.equal(await read(join(f.dir, 'permit-intent.json')), null);
  await reconcilePermitIntent(f.ledger, f.dir, f.local, 'air'); await releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air');
  const released = await f.ledger.read(); assert.equal(released.repositories['owner/b']!.run, 'run-b'); assert.equal(released.owners['run-b']!.generation, remote.owners['run-b']!.generation);
}));

test('failed run.json checkpoint retains intent and recovery records the confirmed grant exactly once', async () => fixture(async f => {
  await f.ledger.releasePermits(f.local.id, 'air', f.local.generation);
  await rename(join(f.dir, 'run.json'), join(f.dir, 'saved-run.json')); await mkdir(join(f.dir, 'run.json'));
  await assert.rejects(acquireRunPermit(f.ledger, f.dir, f.local, 'air'));
  const before = await read(join(f.dir, 'saved-run.json')); const state = await f.ledger.read();
  assert.ok(state.owners[f.local.id]!.generation > before.generation); assert.ok(await read(join(f.dir, 'permit-intent.json')));
  await rm(join(f.dir, 'run.json'), { recursive: true }); await rename(join(f.dir, 'saved-run.json'), join(f.dir, 'run.json'));
  await reconcilePermitIntent(f.ledger, f.dir, before, 'air');
  assert.equal(before.generation, state.owners[f.local.id]!.generation); assert.equal((await f.ledger.read()).revision, state.revision);
  assert.equal((await read(join(f.dir, 'run.json'))).note, 'preserved local metadata');
}));

test('an old recovery intent cannot adopt a later same-host permit generation', async () => fixture(async f => {
  await f.ledger.releasePermits(f.local.id, 'air', f.local.generation);
  const lossy = new GitLedger(f.remote, async (file, args, options) => {
    const result = await command(file, args, options); if (args.includes('push') && result.code === 0) throw new Error('synthetic lost response'); return result;
  });
  await assert.rejects(acquireRunPermit(lossy, f.dir, f.local, 'air'));
  const saved = await readFile(join(f.dir, 'permit-intent.json'), 'utf8'); const grant = (await f.ledger.read()).owners[f.local.id]!.generation;
  await f.ledger.releasePermits(f.local.id, 'air', grant); const newer = await f.ledger.resumeOwned(f.local.id, 'air', grant);
  await assert.rejects(reconcilePermitIntent(f.ledger, f.dir, f.local, 'air'), /specific|exact|stale|recorded/);
  assert.equal(f.local.generation, 1); assert.equal(await readFile(join(f.dir, 'permit-intent.json'), 'utf8'), saved);
  assert.equal((await f.ledger.read()).owners[f.local.id]!.generation, newer.owners[f.local.id]!.generation);
}));

test('all retained resources and malformed or substituted markers block permit release', async () => fixture(async f => {
  await f.ledger.claimBuilder(f.local.id, 'air', f.local.generation);
  for (const name of ['builder-resource.json', 'verifier-resource.json', 'builder-import.json', 'permit-intent.json']) {
    await writeFile(join(f.dir, name), JSON.stringify({ retained: true })); assert.equal(await quiescentResources(f.dir), false);
    await releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air'); assert.equal((await f.ledger.read()).builder!.run, f.local.id);
    await writeFile(join(f.dir, name), '{'); await assert.rejects(releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air')); await rm(join(f.dir, name));
  }
  await writeFile(join(f.root, 'null.json'), 'null'); await symlink(join(f.root, 'null.json'), join(f.dir, 'builder-resource.json'));
  await assert.rejects(releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air'), /regular|symlink/); await rm(join(f.dir, 'builder-resource.json'));
  await releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air'); const after = await f.ledger.read();
  assert.equal(after.builder, null); assert.equal(after.repositories['owner/a'], undefined); assert.ok(after.owners[f.local.id]);
}));

test('stale local generations cannot release or reacquire another generation or overwrite unresolved intent', async () => fixture(async f => {
  const stale = { ...f.local }; await releaseQuiescentPermits(f.ledger, f.dir, f.local, 'air'); await acquireRunPermit(f.ledger, f.dir, f.local, 'air');
  await f.ledger.claimBuilder(f.local.id, 'air', f.local.generation);
  await releaseQuiescentPermits(f.ledger, f.dir, stale, 'air'); assert.equal((await f.ledger.read()).builder!.generation, f.local.generation);
  await assert.rejects(acquireRunPermit(f.ledger, f.dir, stale, 'air'), /stale/);
  await f.ledger.releasePermits(f.local.id, 'air', f.local.generation); const pending = '{"unresolved":true}'; await writeFile(join(f.dir, 'permit-intent.json'), pending);
  await assert.rejects(acquireRunPermit(f.ledger, f.dir, f.local, 'air'), /unresolved|recover/);
  assert.equal(await readFile(join(f.dir, 'permit-intent.json'), 'utf8'), pending);
}));
