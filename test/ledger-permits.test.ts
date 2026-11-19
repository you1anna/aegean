import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitLedger, emptyLedger, Conflict, assertOwned, type Ledger } from '../src/adapters/ledger.js';
import { checked, command } from '../src/adapters/process.js';
import { acquireRunPermit } from '../src/application/ownership.js';
import type { Run, HistoricalRun } from '../src/domain/run.js';
import { transition } from '../src/domain/workflow.js';
import { POLICY } from '../src/domain/workflow-policy.js';
import { digest } from '../src/domain/digest.js';
import { syntheticRun } from './helpers/runs.js';

async function fixture(initial: unknown = emptyLedger()) {
  const root = await mkdtemp(join(tmpdir(), 'aegean-permits-'));
  const remote = join(root, 'remote.git'); const seed = join(root, 'seed'); await mkdir(seed);
  await checked('git', ['init', '--bare', remote]); await checked('git', ['init', '-b', 'control'], { cwd: seed });
  const save = async (state: unknown) => {
    await writeFile(join(seed, 'control.json'), JSON.stringify(state));
    await checked('git', ['add', 'control.json'], { cwd: seed });
    await checked('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'control'], { cwd: seed });
    await checked('git', ['push', remote, 'control'], { cwd: seed });
  };
  await save(initial);
  return { root, remote, seed, ledger: new GitLedger(remote), close: () => rm(root, { recursive: true, force: true }) };
}
const run = (id: string, repository = 'owner/repo', host = 'air') => syntheticRun({ id, repository, host, now: 1 });
const historical = (run: Run): HistoricalRun => {
  const { approver, projectPolicy, revisions, revisionRef, reviewCommit, ...legacy } = run;
  return { ...legacy, schemaVersion: 1, policy: '0.1.0', policyIdentity: digest('historical policy') };
};
const generation = (state: Ledger, id: string) => state.owners[id]!.generation;
const cancelled = (value: Run) => transition(value, { id: `cancel-${value.id}`, at: 2, type: 'cancel' });

test('different repositories can own permits after a real Git CAS race; same repository cannot', async () => {
  const f = await fixture();
  try {
    const a = new GitLedger(f.remote); const b = new GitLedger(f.remote);
    const runs = [run('a', 'owner/a'), run('b', 'owner/b', 'mini')];
    const raced = await Promise.allSettled([a.acquire(runs[0]!), b.acquire(runs[1]!)]);
    assert.ok(raced.some(result => result.status === 'fulfilled'));
    for (const [index, result] of raced.entries()) {
      if (result.status === 'rejected') { assert.ok(result.reason instanceof Conflict); await f.ledger.acquire(runs[index]!); }
    }
    const state = await f.ledger.read();
    assert.deepEqual(Object.keys(state.owners).sort(), ['a', 'b']); assert.equal(state.builder, null);
    assert.equal(state.repositories['owner/a']!.run, 'a'); assert.equal(state.repositories['owner/b']!.run, 'b');
    await assert.rejects(f.ledger.acquire(run('same', 'owner/a', 'mini')), /repository.*active|repository.*permit/);
    await assert.rejects(f.ledger.acquire(run('alias', 'Owner/A', 'mini')), /repository.*active|repository.*permit/);
    await assert.rejects(f.ledger.acquire(run('a', 'owner/another')), /already exists/);
    await assert.rejects(f.ledger.acquire(run('__proto__', 'owner/another')), /invalid control ledger/);
    await assert.rejects(f.ledger.acquire({ ...run('old-policy', 'owner/another'), policy: '0.1.0' }), /policy differs/);
  } finally { await f.close(); }
});

test('same-repository and global Builder races have exactly one winner', async () => {
  const f = await fixture();
  try {
    const raced = await Promise.allSettled([f.ledger.acquire(run('a')), new GitLedger(f.remote).acquire(run('b', 'owner/repo', 'mini'))]);
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
    const state = await f.ledger.read(); const owner = Object.values(state.owners)[0]!;
    const other = run('other', 'owner/other', 'mini'); const acquired = await f.ledger.acquire(other);
    const claimed = await Promise.allSettled([
      f.ledger.claimBuilder(owner.run, owner.host, owner.generation),
      new GitLedger(f.remote).claimBuilder(other.id, other.host, generation(acquired, other.id)),
    ]);
    assert.equal(claimed.filter(result => result.status === 'fulfilled').length, 1);
    const builder = (await f.ledger.read()).builder!;
    const loser = builder.run === owner.run ? acquired.owners[other.id]! : owner;
    await assert.rejects(f.ledger.claimBuilder(loser.run, loser.host, loser.generation), /Builder.*active|Builder.*permit/);
    await f.ledger.releaseBuilder(loser.run, loser.host, loser.generation);
    assert.deepEqual((await f.ledger.read()).builder, builder);
    const retained = await f.ledger.claimBuilder(builder.run, builder.host, builder.generation);
    assert.equal(retained.builder!.generation, builder.generation);
  } finally { await f.close(); }
});

test('human waits release capacity; reacquisition fences old generations and preserves other permits', async () => {
  const f = await fixture();
  try {
    const first = await f.ledger.acquire(run('a')); const old = generation(first, 'a');
    await f.ledger.claimBuilder('a', 'air', old);
    const waiting = await f.ledger.releasePermits('a', 'air', old);
    assert.equal(waiting.owners.a!.generation, old); assert.equal(waiting.repositories['owner/repo'], undefined); assert.equal(waiting.builder, null);
    assert.equal((await f.ledger.releasePermits('a', 'air', old)).revision, waiting.revision);
    const other = await f.ledger.acquire(run('b', 'owner/repo', 'mini')); const otherGeneration = generation(other, 'b');
    await f.ledger.claimBuilder('b', 'mini', otherGeneration);
    await assert.rejects(f.ledger.resumeOwned('a', 'air', old), /repository.*active|repository.*permit/);
    await assert.rejects(f.ledger.owned('a', 'air', old, value => value), /repository.*permit/);
    const repeatedRelease = await f.ledger.releasePermits('a', 'air', old);
    assert.equal(repeatedRelease.repositories['owner/repo']!.run, 'b'); assert.equal(repeatedRelease.builder!.run, 'b');
    await f.ledger.releasePermits('b', 'mini', otherGeneration);
    const resumed = await f.ledger.resumeOwned('a', 'air', old); const current = generation(resumed, 'a');
    assert.ok(current > old); assert.equal(current, resumed.revision);
    assert.equal((await f.ledger.resumeOwned('a', 'air', current)).revision, resumed.revision);
    await f.ledger.claimBuilder('a', 'air', current);
    for (const stale of [
      () => f.ledger.owned('a', 'air', old, cancelled),
      () => f.ledger.resumeOwned('a', 'air', old),
      () => f.ledger.releasePermits('a', 'air', old),
      () => f.ledger.releaseBuilder('a', 'air', old),
      () => f.ledger.claimBuilder('a', 'air', old),
      () => f.ledger.owned('a', 'foreign', current, cancelled),
    ]) await assert.rejects(stale, /stale|foreign/);
    assert.equal((await f.ledger.read()).builder!.generation, current);
    assert.throws(() => assertOwned(resumed, 'a', 'air', old), /stale/);
  } finally { await f.close(); }
});

test('terminal transitions clear only exact own permits and cannot rewrite run identity', async () => {
  const f = await fixture();
  try {
    let state = await f.ledger.acquire(run('a', 'Owner/A'));
    assert.equal(state.runs.a!.repository, 'Owner/A'); assert.equal(state.repositories['owner/a']!.run, 'a');
    const a = generation(state, 'a'); state = await f.ledger.acquire(run('b', 'owner/b', 'mini')); const b = generation(state, 'b');
    await f.ledger.claimBuilder('b', 'mini', b);
    await assert.rejects(f.ledger.owned('a', 'air', a, value => ({ ...value, repository: 'owner/b' })), /identity/);
    await assert.rejects(f.ledger.owned('a', 'air', a, value => { value.approver.id = 99; return value; }), /approver/);
    await assert.rejects(f.ledger.owned('a', 'air', a, value => ({ ...value, projectPolicy: digest('changed') })), /project policy/);
    const ended = await f.ledger.owned('a', 'air', a, cancelled);
    assert.equal(ended.owners.a, undefined); assert.equal(ended.repositories['owner/a'], undefined);
    assert.equal(ended.builder!.run, 'b'); assert.equal(ended.owners.b!.generation, b);
    const complete = await f.ledger.cancelOwned('b', 'mini', b, cancelled);
    assert.equal(complete.runs.b!.state, 'cancelled');
    assert.deepEqual(complete.owners, {}); assert.deepEqual(complete.repositories, {}); assert.equal(complete.builder, null);
    await assert.rejects(f.ledger.resumeOwned('a', 'air', a), /stale|terminal/);
  } finally { await f.close(); }
});

test('legacy ledgers fail closed until explicit quiescent migration preserves revision and history', async () => {
  const history = { old: historical(cancelled(run('old'))) };
  const f = await fixture({ schemaVersion: 1, revision: 9, owner: null, runs: history });
  try {
    const oldHead = await checked('git', ['rev-parse', 'control'], { cwd: f.remote });
    await assert.rejects(f.ledger.read(), /migration|legacy/);
    await assert.rejects(f.ledger.acquire(run('new')), /migration|legacy/);
    const migrated = await f.ledger.migrateQuiescent();
    assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.revision, 9); assert.deepEqual(migrated.runs, history);
    assert.deepEqual(migrated.owners, {}); assert.deepEqual(migrated.repositories, {}); assert.equal(migrated.builder, null);
    assert.equal((await f.ledger.migrateQuiescent()).revision, 9);
    assert.equal((await command('git', ['merge-base', '--is-ancestor', oldHead, 'control'], { cwd: f.remote })).code, 0);
    assert.notEqual(migrated.schemaVersion, 1); assert.equal('owner' in migrated, false);
  } finally { await f.close(); }
  for (const active of [
    { schemaVersion: 1, revision: 1, owner: { run: 'a', host: 'air', generation: 1 }, runs: { a: historical(run('a')) } },
    { schemaVersion: 1, revision: 1, owner: null, runs: { a: historical(run('a')) } },
  ]) {
    const f = await fixture(active);
    try { await assert.rejects(f.ledger.migrateQuiescent(), /quiescent|active|terminal/); }
    finally { await f.close(); }
  }
});

test('malformed persisted permits and unbounded run fields are rejected before mutation', async () => {
  const a = run('a'); const permit = { run: 'a', host: 'air', generation: 1 };
  const valid: Ledger = { schemaVersion: 2, revision: 1, owners: { a: permit }, repositories: { 'owner/repo': permit }, builder: null, runs: { a } };
  const malformed: unknown[] = [
    { ...valid, owner: permit },
    { ...valid, revision: -1 },
    { ...valid, owners: { a: { ...permit, generation: 2 } } },
    { ...valid, repositories: { 'owner/wrong': permit } },
    { ...valid, builder: { ...permit, host: 'mini' } },
    { ...valid, owners: {} },
    { ...valid, runs: { a: { ...a, state: 'invented' } } },
    { ...valid, runs: { a: historical(a) } },
    { ...valid, runs: { a: { ...a, reason: 'x'.repeat(20_000) } } },
  ];
  for (const value of malformed) {
    const f = await fixture(value);
    try { await assert.rejects(f.ledger.read(), /invalid control ledger/); }
    finally { await f.close(); }
  }
  assert.throws(() => new GitLedger('-upload-pack=unsafe'), /invalid control remote/);
  assert.throws(() => new GitLedger('bad\0remote'), /invalid control remote/);
});

test('lost push response reconciles the accepted commit beneath a later descendant without replay', async () => {
  const f = await fixture(); let lost = false; let effects = 0;
  const ledger = new GitLedger(f.remote, async (file, args, options) => {
    const result = await command(file, args, options);
    if (!lost && args.includes('push') && result.code === 0) {
      lost = true;
      await f.ledger.acquire(run('b', 'owner/b', 'mini'));
      return { ...result, code: 1, stderr: 'synthetic response lost' };
    }
    return result;
  });
  try {
    await ledger.update(state => {
      effects++; const next = run('a'); state.runs.a = next;
      const permit = { run: next.id, host: next.host, generation: state.revision + 1 };
      state.owners.a = permit; state.repositories[next.repository] = permit; return state;
    });
    assert.equal(lost, true); assert.equal(effects, 1);
    const observed = await f.ledger.read(); assert.equal(observed.revision, 2); assert.deepEqual(Object.keys(observed.owners).sort(), ['a', 'b']);
  } finally { await f.close(); }
});

test('original bootstrap history without policy identity is inspected read-only and preserved exactly by explicit migration', async () => {
  const {policyIdentity: firstIdentity,...first}=historical(cancelled(run('old-a')));
  const {policyIdentity: secondIdentity,...second}=historical(cancelled(run('old-b')));
  void firstIdentity;void secondIdentity;
  const history={'old-a':first,'old-b':second};const f=await fixture({schemaVersion:1,revision:5,owner:null,runs:history});
  try{
    const head=await checked('git',['rev-parse','control'],{cwd:f.remote});const preview=await f.ledger.inspectMigration();
    assert.equal(preview.terminalRuns,2);assert.equal(await checked('git',['rev-parse','control'],{cwd:f.remote}),head);
    const migrated=await f.ledger.migrateQuiescent(head);assert.deepEqual(migrated.runs,history);assert.equal('policyIdentity' in migrated.runs['old-a']!,false);
    assert.deepEqual((await f.ledger.migrateQuiescent()).runs,history);await assert.rejects(f.ledger.resumeOwned('old-a','air',1),/stale|terminal/);
    const {assertRunPolicy}=await import('../src/domain/run.js');assert.throws(()=>assertRunPolicy(migrated.runs['old-a']!),/policy differs/);
    await assert.rejects(f.ledger.migrateQuiescent(head),/source changed/);
  }finally{await f.close();}
});
test('missing historical identity is restricted to terminal bootstrap records and consistent keys',async()=>{
  const {policyIdentity,...old}=historical(cancelled(run('old')));void policyIdentity;
  const invalid=[
    {schemaVersion:1,revision:5,owner:null,runs:{old:{...old,state:'requested'}}},
    {schemaVersion:1,revision:5,owner:null,runs:{old:{...old,policy:'0.2.0'}}},
    {schemaVersion:1,revision:5,owner:null,runs:{old:{...old,policyIdentity:'invalid'}}},
    {schemaVersion:1,revision:5,owner:{run:'old',host:'air',generation:1},runs:{old}},
    {schemaVersion:1,revision:5,owner:null,runs:{wrong:old}},
    {schemaVersion:2,revision:5,owners:{},repositories:{},builder:null,runs:{old:{...cancelled(run('old')),policyIdentity:undefined}}},
  ];
  for(const value of invalid){const f=await fixture(value);try{await assert.rejects(f.ledger.inspectMigration(),/invalid|quiescent/);await assert.rejects(f.ledger.migrateQuiescent(),/invalid|quiescent/);}finally{await f.close();}}
});

test('a run from an older policy can only be cancelled: permits are reacquired and released, every other change fails closed', async () => {
  const older: Run = { ...run('older'), state: 'spec-drafted', policy: '0.4.0', policyIdentity: digest('older policy') };
  const f = await fixture({ ...emptyLedger(), revision: 3, owners: { older: { run: 'older', host: 'air', generation: 3 } }, runs: { older } });
  try {
    const dir = await mkdtemp(join(f.root, 'run-')); const local = { id: 'older', generation: 3 };
    await acquireRunPermit(f.ledger, dir, local, 'air');
    const held = await f.ledger.read(); assert.ok(local.generation > 3); assert.equal(held.repositories['owner/repo']!.generation, local.generation);
    await assert.rejects(f.ledger.owned('older', 'air', local.generation, value => value), /policy differs/);
    await assert.rejects(f.ledger.owned('older', 'air', local.generation, cancelled), /policy differs/);
    await assert.rejects(f.ledger.claimBuilder('older', 'air', local.generation), /policy differs/);
    assert.throws(() => assertOwned(held, 'older', 'air', local.generation), /policy differs/);
    await assert.rejects(f.ledger.cancelOwned('older', 'air', local.generation, value => ({ ...value, state: 'paused' })), /only cancel/);
    await assert.rejects(f.ledger.cancelOwned('older', 'air', local.generation, value => ({ ...cancelled(value), policy: POLICY.version })), /identity/);
    await assert.rejects(f.ledger.cancelOwned('older', 'foreign', local.generation, cancelled), /stale|foreign/);
    const ended = await f.ledger.cancelOwned('older', 'air', local.generation, cancelled);
    assert.equal(ended.runs.older!.state, 'cancelled'); assert.equal(ended.runs.older!.policy, '0.4.0');
    assert.deepEqual(ended.owners, {}); assert.deepEqual(ended.repositories, {}); assert.equal(ended.builder, null);
    await assert.rejects(f.ledger.cancelOwned('older', 'air', local.generation, cancelled), /stale|foreign/);
  } finally { await f.close(); }
});
