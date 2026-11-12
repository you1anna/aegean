import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checked, command } from '../src/adapters/process.js';
import { GitLedger, emptyLedger } from '../src/adapters/ledger.js';
import { createRun } from '../src/domain/workflow.js';
import { approvalFrom } from '../src/adapters/github.js';
import { subscriptionEnvironment, claudeArgs } from '../src/adapters/agents.js';
import { containerArgs, exportCommit } from '../src/adapters/verifier.js';
import { reportedUsage } from '../src/adapters/usage.js';

test('token accounting preserves unknown and reads provider-reported usage only', () => {
  assert.deepEqual(reportedUsage('no usage available'), { input: null, output: null, cachedInput: null });
  assert.deepEqual(reportedUsage('{"usage":{"input_tokens":10,"output_tokens":2,"cache_read_input_tokens":8}}'), { input: 10, output: 2, cachedInput: 8 });
  assert.deepEqual(reportedUsage('{"type":"started"}\n{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":3,"cached_input_tokens":5}}\n'), { input: 12, output: 3, cachedInput: 5 });
});

test('concurrent hosts cannot both acquire ownership; stale generations cannot publish', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aegean-ledger-test-'));
  try {
    const remote = join(dir, 'remote.git'); const seed = join(dir, 'seed'); await mkdir(seed);
    await checked('git', ['init', '--bare', remote]); await checked('git', ['init', '-b', 'control'], { cwd: seed });
    await writeFile(join(seed, 'control.json'), JSON.stringify(emptyLedger()));
    await checked('git', ['add', '.'], { cwd: seed });
    await checked('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'seed'], { cwd: seed });
    await checked('git', ['push', remote, 'control'], { cwd: seed });
    const a = new GitLedger(remote); const b = new GitLedger(remote);
    const results = await Promise.allSettled([
      a.acquire(createRun('run-a', 'host-a', 'o/r', '0.1.0', 0)),
      b.acquire(createRun('run-b', 'host-b', 'o/r', '0.1.0', 0)),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const state = await a.read(); assert.equal(Object.keys(state.runs).length, 1);
    const owner = state.owner!;
    await assert.rejects(a.owned(owner.run, owner.host, owner.generation + 1, r => r), /stale/);
    await assert.rejects(b.acquire(createRun('run-c', 'host-c', 'o/r', '0.1.0', 0)), /no automatic takeover/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('only exact, current, human-owner approval comments are accepted', () => {
  const c = { user: { login: 'owner', type: 'User' }, body: '/aegean approve-spec abc', html_url: 'receipt', created_at: new Date(1000).toISOString() };
  assert.equal(approvalFrom([c], 'owner', 'abc', 0), 'receipt');
  assert.equal(approvalFrom([c], 'owner', 'changed', 0), undefined);
  assert.equal(approvalFrom([c], 'owner', 'abc', 2000), undefined);
  assert.equal(approvalFrom([{ ...c, user: { login: 'owner', type: 'Bot' } }], 'owner', 'abc', 0), undefined);
});
test('API billing and provider overrides are rejected; child environments exclude secrets', () => {
  assert.throws(() => subscriptionEnvironment({ OPENAI_API_KEY: 'synthetic' }), /subscription-only/);
  assert.throws(() => subscriptionEnvironment({ CLAUDE_CODE_USE_BEDROCK: '1' }), /subscription-only/);
  const env = subscriptionEnvironment({ PATH: '/bin', GH_TOKEN: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic' });
  assert.equal(env.GH_TOKEN, undefined); assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.ok(claudeArgs().includes('--restricted')); assert.ok(!claudeArgs().includes('--bare'));
});
test('process execution is bounded on excessive output and time', async () => {
  const noisy = await command(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000));setInterval(()=>{},1000)'], { maxBytes: 1000, timeoutMs: 2000 });
  assert.equal(noisy.interrupted, true); assert.ok(noisy.stdout.length <= 1000);
  const slow = await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 80 });
  assert.equal(slow.interrupted, true); assert.ok(slow.durationMs < 2000);
});
test('oracle never mounts protected tests or host credentials into candidate container', () => {
  const args = containerArgs('test', '/tmp/candidate', 'node@sha256:' + 'a'.repeat(64), ['node', 'app.js']);
  assert.ok(args.includes('--network=none')); assert.ok(args.includes('--read-only'));
  assert.equal(args.filter(a => a.startsWith('type=bind')).length, 1);
  assert.ok(args.includes('--cap-drop=ALL')); assert.ok(!args.some(a => a.includes('docker.sock')));
  assert.throws(() => containerArgs('test', '/tmp/a,other', 'node:latest', ['node']), /invalid/);
});
test('candidate export refuses symlinks and preserves binary bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aegean-export-test-'));
  try {
    const repo = join(dir, 'repo'); await mkdir(repo); await checked('git', ['init', '-b', 'main'], { cwd: repo });
    const bytes = Buffer.from([0, 255, 254, 128, 10]); await writeFile(join(repo, 'binary'), bytes);
    await checked('git', ['add', '.'], { cwd: repo }); await checked('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'binary'], { cwd: repo });
    const sha = await checked('git', ['rev-parse', 'HEAD'], { cwd: repo }); const out = join(dir, 'out'); await mkdir(out);
    await exportCommit(repo, sha, out);
    const { readFile, symlink } = await import('node:fs/promises'); assert.deepEqual(await readFile(join(out, 'binary')), bytes);
    await symlink('/etc/passwd', join(repo, 'escape')); await checked('git', ['add', '.'], { cwd: repo });
    await checked('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'link'], { cwd: repo });
    const other = join(dir, 'other'); await mkdir(other);
    await assert.rejects(exportCommit(repo, await checked('git', ['rev-parse', 'HEAD'], { cwd: repo }), other), /symlinks/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
