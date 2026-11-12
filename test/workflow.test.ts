import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, transition, digest, type Run, type Event } from '../src/domain/workflow.js';

const spec = digest('approved requirement');
const suite = digest('independent suite');
const commit = 'a'.repeat(40);
const start = () => createRun('run-1', 'host-a', 'owner/repo', '0.1.0', 100);
const event = (type: Event['type'], data: Record<string, unknown> = {}): Event =>
  ({ id: crypto.randomUUID(), at: 101, type, ...data } as Event);
function staged(): Run {
  let run = transition(start(), event('draft', { spec }));
  run = transition(run, event('approve', { spec, actor: 'human', approvalRef: 'https://github.com/o/r/pull/1#issuecomment-1' }));
  return transition(run, event('stage-tests', { suite, spec, activeMs: 0 }));
}
test('policy drift blocks effects but permits deliberate cancellation', () => {
  for (const changed of [{ ...start(), policy: 'different' }, { ...start(), policyIdentity: '0'.repeat(64) }]) {
    assert.throws(() => transition(changed, event('draft', { spec })), /policy differs/);
    assert.equal(transition(changed, event('cancel')).state, 'cancelled');
  }
});
test('approval is bound to the published specification commit', () => {
  const run = transition(start(), event('draft', { spec, specCommit: commit }));
  assert.throws(() => transition(run, event('approve', { spec, actor: 'human', approvalRef: 'receipt', specCommit: 'b'.repeat(40) })), /published commit/);
});
function reviewed(run: Run, passed: boolean): Run {
  run = transition(run, event('begin-build'));
  run = transition(run, event('candidate', { commit, activeMs: 10 }));
  run = transition(run, event('verification', { commit, spec, suite, outcome: passed ? 'pass' : 'fail', receipt: digest('receipt'), activeMs: 10 }));
  return transition(run, event('review', { commit, outcome: passed ? 'pass' : 'repair', activeMs: 10 }));
}
test('human approval and independent suite are required before building', () => {
  assert.throws(() => transition(start(), event('begin-build')), /state/);
  const drafted = transition(start(), event('draft', { spec }));
  assert.throws(() => transition(drafted, event('approve', { spec: digest('changed'), actor: 'human', approvalRef: 'url' })), /spec/);
  assert.throws(() => transition(drafted, event('stage-tests', { suite, spec })), /state/);
  assert.equal(staged().state, 'tests-staged');
});
test('stale commit, spec and suite cannot produce a passing gate', () => {
  let run = transition(staged(), event('begin-build'));
  run = transition(run, event('candidate', { commit, activeMs: 1 }));
  for (const stale of [{ commit: 'b'.repeat(40) }, { spec: digest('new') }, { suite: digest('new') }]) {
    assert.throws(() => transition(run, event('verification', { commit, spec, suite, outcome: 'pass', receipt: digest('receipt'), activeMs: 1, ...stale })), /stale/);
  }
});
test('two repairs are allowed and a third failure escalates', () => {
  let run = staged();
  for (let i = 0; i < 2; i++) {
    run = reviewed(run, false);
    assert.equal(run.state, 'repair');
    assert.equal(run.repairs, i + 1);
  }
  run = reviewed(run, false);
  assert.equal(run.state, 'escalated');
  assert.equal(run.repairs, 2);
  assert.throws(() => transition(run, event('begin-build')), /state/);
});
test('infrastructure failure is inconclusive and bounded separately', () => {
  let run = transition(staged(), event('begin-build'));
  run = transition(run, event('candidate', { commit, activeMs: 1 }));
  const fail = () => event('verification', { commit, spec, suite, outcome: 'inconclusive', receipt: digest('infra'), activeMs: 1 });
  run = transition(run, fail());
  assert.equal(run.state, 'verifying');
  assert.equal(run.infrastructureRetries, 1);
  assert.equal(run.repairs, 0);
  run = transition(run, fail());
  assert.equal(run.state, 'escalated');
});
test('events are idempotent; terminal runs cannot be resurrected', () => {
  const e = event('cancel');
  const run = transition(start(), e);
  assert.deepEqual(transition(run, e), run);
  assert.throws(() => transition(run, event('resume')), /state/);
});
test('spec revision invalidates approval, suite and candidate', () => {
  const run = transition(staged(), event('draft', { spec: digest('revision') }));
  assert.equal(run.state, 'spec-drafted');
  assert.equal(run.suite, undefined);
  assert.equal(run.approvalRef, undefined);
  assert.equal(run.commit, undefined);
});
test('only passing verification and review allow human merge', () => {
  let run = reviewed(staged(), true);
  assert.equal(run.state, 'human-merge-review');
  assert.throws(() => transition(run, event('merged', { commit: 'b'.repeat(40), mergeCommit: 'c'.repeat(40), actor: 'human' })), /commit/);
  run = transition(run, event('merged', { commit, mergeCommit: 'c'.repeat(40), actor: 'human' }));
  assert.equal(transition(run, event('archive')).state, 'archived');
});
test('active time limit pauses work without losing its recovery state', () => {
  let run = transition(staged(), event('begin-build'));
  run = transition(run, event('candidate', { commit, activeMs: 3600001 }));
  assert.equal(run.state, 'paused');
  assert.equal(run.resumeState, 'verifying');
  assert.throws(() => transition(run, event('resume')), /budget/);
});
