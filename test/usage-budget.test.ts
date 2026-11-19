import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initializeBudget, budgetStatus, budgetedRole as invokeRole } from '../src/application/usage-budget.js';
import { identity } from '../src/domain/digest.js';
import type { ModelCall } from '../src/application/model-call.js';
import { POLICY } from '../src/domain/workflow-policy.js';
import { syntheticRun } from './helpers/runs.js';
const tokenPolicy = { enforcement: 'monitored' as const, maxTokensPerRun: 10000, maxTokensPerCall: 100 };
const call: ModelCall = { role: 'scout', profile: POLICY.models.roles.scout.baseline, cliVersion: 'test', contextDigest: 'a'.repeat(64), budgetIdentity: identity(tokenPolicy), generation: 1, requireReportedModel: false, assertOwned: async () => {} };
const budgetedRole = (...args: Parameters<typeof invokeRole> extends [...infer A, ModelCall] ? A : never) => invokeRole(...args, call);
const result = { code: 0, stdout: JSON.stringify({ type: 'result', usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 } }), stderr: '', interrupted: false, durationMs: 5 };
async function fixture(fn: (dir: string) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), 'aegean-budget-test-')); try { await initializeBudget(dir, tokenPolicy); await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
test('usage reservations cap calls before execution; confirmed replay does not consume capacity', async () => fixture(async dir => {
  let calls = 0; const invoke = async () => { calls++; return result; };
  await budgetedRole(dir, 'scout-0', 100, 1, invoke);
  await budgetedRole(dir, 'scout-0', 100, 1, invoke);
  await assert.rejects(budgetedRole(dir, 'builder-0', 100, 1, invoke), /usage budget/);
  assert.equal(calls, 1); assert.equal((await budgetStatus(dir)).calls, 1);
}));
test('uncertain and failed calls remain charged and concurrent reservations serialize', async () => fixture(async dir => {
  await assert.rejects(budgetedRole(dir, 'lost', 100, 2, async () => { throw new Error('lost response'); }), /lost response/);
  await assert.rejects(budgetedRole(dir, 'lost', 100, 2, async () => result), /Unknown outcome/);
  const attempts = await Promise.allSettled(['a', 'b'].map(key => budgetedRole(dir, key, 100, 2, async () => ({ ...result, code: 1 }))));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 0);
  const usage = await budgetStatus(dir); assert.equal(usage.calls, 1); assert.ok(usage.activeMs >= 100);
}));
test('missing, malformed and drifted accounting fail closed', async () => fixture(async dir => {
  const path = join(dir, 'model-budget.json'); const original = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...original, policyIdentity: '0'.repeat(64) }));
  await assert.rejects(budgetStatus(dir), /policy/);
  await writeFile(path, '{}'); await assert.rejects(budgetStatus(dir));
  await rm(path); await assert.rejects(budgetedRole(dir, 'x', 1, POLICY.maxModelCalls, async () => result));
}));

test('expiry and active, repair, revision budgets reject execution at their exact boundaries', async () => {
  const { remainingExecution, defaultBudget } = await import('../src/domain/budgets.js');
  const run = syntheticRun({ id: 'test', host: 'host', now: 1 });
  assert.equal(remainingExecution(run, defaultBudget, 0, 100, 101), 1);
  assert.throws(() => remainingExecution(run, defaultBudget, 0, 100, 100), /expired/);
  assert.throws(() => remainingExecution(run, defaultBudget, defaultBudget.activeTimeoutMs, 1), /budget exhausted/);
  assert.throws(() => remainingExecution({ ...run, repairs: 1 }, { ...defaultBudget, maxRepairs: 0 }, 0, 1), /repair/);
  assert.throws(() => remainingExecution({ ...run, revisions: 1 }, { ...defaultBudget, maxRevisions: 0 }, 0, 1), /revision/);
});

test('verification time survives interruption and completed model receipts settle without replay', async () => fixture(async dir => {
  const { budgetedExecution, reconcileCompletedBudget } = await import('../src/application/usage-budget.js');
  await budgetedRole(dir, 'done', 1000, 2, async () => result);
  const path = join(dir, 'model-budget.json'); const saved = JSON.parse(await readFile(path, 'utf8'));
  delete saved.reservations.done.durationMs; await writeFile(path, JSON.stringify(saved));
  await reconcileCompletedBudget(dir); assert.equal((await budgetStatus(dir)).uncertain, 0);
  let repeated = false; await budgetedRole(dir, 'done', 1000, 2, async () => { repeated = true; return result; }); assert.equal(repeated, false);
  await assert.rejects(budgetedExecution(dir, 'verification', 2000, async () => { throw new Error('killed verifier'); }));
  const usage = await budgetStatus(dir); assert.equal(usage.calls, 1); assert.equal(usage.activeMs, 2005);
}));

test('token admission rejects strict caps, missing usage and stale owners before another process', async () => fixture(async dir => {
  let launches = 0;
  await assert.rejects(invokeRole(dir, 'stale', 100, 5, async () => { launches++; return result; }, { ...call, assertOwned: async () => { throw new Error('stale owner'); } }), /stale owner/);
  assert.equal(launches, 0);
  await assert.rejects(invokeRole(dir, 'unknown', 100, 5, async () => { launches++; return { ...result, stdout: '{}' }; }, call), /unknown token usage/);
  await assert.rejects(invokeRole(dir, 'later', 100, 5, async () => { launches++; return result; }, call), /unknown token usage/);
  assert.equal(launches, 1);
  assert.equal((await budgetStatus(dir)).tokens!.reserved, 100);
  const path = join(dir, 'model-budget.json'); const value = JSON.parse(await readFile(path, 'utf8'));
  value.tokenPolicy.enforcement = 'strict'; value.reservations = {}; await writeFile(path, JSON.stringify(value));
  await assert.rejects(invokeRole(dir, 'strict', 100, 5, async () => { launches++; return result; }, { ...call, budgetIdentity: identity(value.tokenPolicy) }), /unsupported/);
  assert.equal(launches, 1);
}));

test('completed usage reconstructs once; changed model and budget identity cannot reuse an effect', async () => fixture(async dir => {
  const { reconcileCompletedBudget } = await import('../src/application/usage-budget.js');
  const { readdir, rm } = await import('node:fs/promises');
  await budgetedRole(dir, 'done', 100, 5, async () => result);
  const path = join(dir, 'model-budget.json'); const value = JSON.parse(await readFile(path, 'utf8'));
  delete value.reservations.done.consumed; await writeFile(path, JSON.stringify(value));
  await rm(join(dir, 'usage/done.json'));
  await reconcileCompletedBudget(dir); await reconcileCompletedBudget(dir);
  assert.equal((await budgetStatus(dir)).tokens!.consumed, 15);
  assert.deepEqual(await readdir(join(dir, 'usage')), ['done.json']);
  await assert.rejects(invokeRole(dir, 'done', 100, 5, async () => result, { ...call, profile: { ...call.profile, model: 'claude-other' } }), /identity changed/);
  await assert.rejects(invokeRole(dir, 'new', 100, 5, async () => result, { ...call, budgetIdentity: 'f'.repeat(64) }), /budget policy/);
}));

test('concurrent token admissions cannot spend the same allowance', async () => fixture(async dir => {
  let launches = 0; let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const first = invokeRole(dir, 'first', 100, 5, async () => { launches++; await wait; return result; }, call);
  while (launches === 0) await new Promise(resolve => setTimeout(resolve, 2));
  try { await assert.rejects(invokeRole(dir, 'second', 100, 5, async () => { launches++; return result; }, call), /unknown token usage/); }
  finally { finish(); await first; }
  assert.equal(launches, 1);
}));

test('interrupted calls retain their reservation even with an earlier usage result', async () => fixture(async dir => {
  await assert.rejects(budgetedRole(dir, 'partial', 100, 5, async () => ({ ...result, interrupted: true })), /unknown token usage/);
  assert.equal((await budgetStatus(dir)).tokens!.reserved, 100);
  assert.equal((await budgetStatus(dir)).tokens!.consumed, 0);
}));

test('a completed effect keeps its original context identity when candidate HEAD changes', async () => fixture(async dir => {
  let calls = 0;
  await invokeRole(dir, 'builder', 100, 5, async () => { calls++; return result; }, call);
  await invokeRole(dir, 'builder', 100, 5, async () => { calls++; return result; }, { ...call, contextDigest: 'b'.repeat(64), generation: 2 });
  assert.equal(calls, 1);
  const recorded = JSON.parse(await readFile(join(dir, 'usage/builder.json'), 'utf8'));
  assert.equal(recorded.contextDigest, call.contextDigest); assert.equal(recorded.generation, 1);
}));
