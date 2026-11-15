import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checked, command } from '../src/adapters/process.js';
import { GitLedger, emptyLedger } from '../src/adapters/ledger.js';
import { createRun, POLICY, digest } from '../src/domain/workflow.js';
import { approvalFrom, assertApprover, resolveApprover, authenticatedApprover, approval, commandReceipt, publicationCommand } from '../src/adapters/github.js';
import { subscriptionEnvironment, claudeArgs } from '../src/adapters/agents.js';
import { containerArgs, exportCommit } from '../src/adapters/verifier.js';
import { reportedUsage } from '../src/adapters/usage.js';
const frozen = { approver: { id: 42, login: 'reviewer' }, projectPolicy: digest('frozen project policy') };

test('token accounting preserves unknown and reads provider-reported usage only', () => {
  assert.deepEqual(reportedUsage('null\n42\n{}'), { input: null, output: null, cachedInput: null });
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
      a.acquire(createRun('run-a', 'host-a', 'o/r', POLICY.version, 0, frozen)),
      b.acquire(createRun('run-b', 'host-b', 'o/r', POLICY.version, 0, frozen)),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const state = await a.read(); assert.equal(Object.keys(state.runs).length, 1);
    const owner = Object.values(state.owners)[0]!;
    await assert.rejects(a.owned(owner.run, owner.host, owner.generation + 1, r => r), /stale/);
    await assert.rejects(b.acquire(createRun('run-c', 'host-c', 'o/r', POLICY.version, 0, frozen)), /no automatic takeover/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('only exact current commands from the explicit stable human approver are accepted', () => {
  const c = { user: { id: 42, login: 'renamed-reviewer', type: 'User' }, body: '/aegean approve-spec abc', html_url: 'https://github.com/org/repo/pull/1#issuecomment-1', created_at: new Date(1000).toISOString() };
  assert.equal(approvalFrom([c], frozen.approver, 'abc', 0), c.html_url);
  assert.equal(approvalFrom([c], frozen.approver, 'changed', 0), undefined);
  assert.equal(approvalFrom([c], frozen.approver, 'abc', 2000), undefined);
  for (const user of [{ id: 42, login: 'reviewer', type: 'Bot' }, { id: 99, login: 'reviewer', type: 'User' }, { id: 42, login: 'organisation', type: 'Organization' }, { login: 'reviewer', type: 'User' }]) {
    assert.equal(approvalFrom([{ ...c, user }], frozen.approver, 'abc', 0), undefined);
    assert.throws(() => assertApprover(user, frozen.approver), /human|identity/);
  }
  assert.deepEqual(assertApprover(c.user, frozen.approver), { id: 42, login: 'renamed-reviewer' });
  assert.equal(approvalFrom([null, {}, { ...c, created_at: 'invalid' }], frozen.approver, 'abc', 0), undefined);
});

test('GitHub resolution, authenticated identity and organisation approvals use explicit stable IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegean-github-fixture-')); const oldPath = process.env.PATH;
  const account = { id: 42, login: 'renamed-reviewer', type: 'User' };
  const receipt = 'https://github.com/organisation/repo/pull/1#issuecomment-1';
  const fixtures: Record<string, unknown> = {
    'users/reviewer': account,
    user: account,
    'users/organisation': { id: 1, login: 'organisation', type: 'Organization' },
    'repos/organisation/repo/issues/1/comments?per_page=100&page=1': [{ user: account, body: '/aegean approve-spec abc def', html_url: receipt, created_at: new Date(1000).toISOString() }],
  };
  try {
    const binary = join(root, 'gh');
    await writeFile(binary, `#!${process.execPath}\nconst fixtures=${JSON.stringify(fixtures)};if(process.argv[2]!=='api'||!(process.argv[3] in fixtures))process.exit(91);process.stdout.write(JSON.stringify(fixtures[process.argv[3]]));\n`);
    await chmod(binary, 0o755); process.env.PATH = `${root}:${oldPath ?? ''}`;
    assert.deepEqual(await resolveApprover('reviewer'), { id: 42, login: 'renamed-reviewer' });
    assert.deepEqual(await authenticatedApprover(frozen.approver), { id: 42, login: 'renamed-reviewer' });
    await assert.rejects(resolveApprover('organisation'), /human/);
    await assert.rejects(authenticatedApprover({ id: 99, login: 'reviewer' }), /identity/);
    assert.equal(await approval('organisation/repo', 1, frozen.approver, 'abc', 0, 'def'), receipt);
    assert.equal(await commandReceipt('organisation/repo', 1, { id: 99, login: 'organisation' }, '/aegean approve-spec abc def', 0), undefined);
    assert.equal(publicationCommand('head', 'spec', 'suite', 'receipt'), '/aegean approve-publish head spec suite receipt');
  } finally { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; await rm(root, { recursive: true, force: true }); }
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
