import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, transition, digest, POLICY, POLICY_IDENTITY, policyIdentityFor, policyFromToolchain, type Run, type Event } from '../src/domain/workflow.js';
import { ProjectSchema } from '../src/domain/config.js';
import toolchain from '../toolchain.json' with { type: 'json' };

const spec = digest('approved requirement');
const suite = digest('independent suite');
const commit = 'a'.repeat(40);
const frozen = { approver: { id: 42, login: 'reviewer' }, projectPolicy: digest('frozen project policy') };
const start = () => createRun('run-1', 'host-a', 'owner/repo', POLICY.version, 100, frozen);
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
test('the frozen policy identity includes the separately bounded revision budget', () => {
  assert.equal(policyIdentityFor(toolchain), POLICY_IDENTITY);
  assert.notEqual(policyIdentityFor({ ...toolchain, maxRevisions: toolchain.maxRevisions + 1 }), POLICY_IDENTITY);
  assert.throws(() => policyFromToolchain({ ...toolchain, maxRevisions: -1 }), /policy pins/);
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
  assert.throws(() => transition(run, event('merged', { commit, mergeCommit: 'c'.repeat(40), actor: 'human' })), /publication|published/);
  run = transition(run, event('authorize-publication', { commit, spec, suite, receipt: run.receipt, actor: 'human', approvalRef: 'publication' }));
  assert.throws(() => transition(run, event('merged', { commit: 'b'.repeat(40), mergeCommit: 'c'.repeat(40), actor: 'human' })), /commit/);
  run = transition(run, event('merged', { commit, mergeCommit: 'c'.repeat(40), actor: 'human' }));
  assert.equal(transition(run, event('archive')).state, 'archived');
});

test('project policy requires an explicit human approver for personal and organisation repositories', () => {
  const configuration = { schemaVersion: 2, standardVersion: POLICY.version, repository: 'organisation/repo', approver: frozen.approver, checks: [['node', '--test']], verifier: { kind: 'cli', image: toolchain.verifier.image, command: ['node', 'main.js'] } };
  const project = ProjectSchema.parse(configuration);
  assert.equal(project.approvalMode, 'local'); assert.deepEqual(project.approver, frozen.approver);
  assert.equal(ProjectSchema.parse({ ...configuration, approvalMode: 'github-comments' }).approvalMode, 'github-comments');
  assert.throws(() => ProjectSchema.parse({ ...configuration, approver: undefined }));
  assert.throws(() => ProjectSchema.parse({ ...configuration, approver: { id: 0, login: 'reviewer' } }));
  const created = start(); frozen.approver.login = 'renamed'; assert.equal(created.approver.login, 'reviewer'); frozen.approver.login = 'reviewer';
  assert.equal(created.schemaVersion, 2); assert.equal(created.revisions, 0);
});

test('implementation revision invalidates exact candidate evidence and requires fresh verification, review and publication', () => {
  let run = reviewed(staged(), true);
  run = transition(run, event('authorize-publication', { commit, spec, suite, receipt: run.receipt, actor: 'human', approvalRef: 'old-publication' }));
  const changed = 'b'.repeat(40); const revision = event('revise', { commit: changed, scope: 'implementation', actor: 'human', approvalRef: 'human-revision' });
  assert.throws(() => transition(run, event('draft', { spec: digest('bypass') })), /state/);
  const previous = run; run = transition(run, revision);
  assert.equal(run.state, 'verifying'); assert.equal(run.commit, changed); assert.equal(run.revisions, 1);
  assert.equal(run.revisionRef, 'human-revision'); assert.equal(run.spec, spec); assert.equal(run.suite, suite); assert.equal(run.approvalRef, previous.approvalRef);
  for (const key of ['verification', 'receipt', 'reviewCommit', 'publicationRef', 'repairReceipt'] as const) assert.equal(run[key], undefined);
  assert.equal(run.activeMs, previous.activeMs); assert.equal(run.repairs, previous.repairs);
  assert.deepEqual(transition(run, revision), run);
  assert.throws(() => transition(run, event('merged', { commit: changed, mergeCommit: 'c'.repeat(40), actor: 'human' })), /state/);
  assert.throws(() => transition(run, event('verification', { commit, spec, suite, outcome: 'pass', receipt: digest('old'), activeMs: 0 })), /stale/);
  run = transition(run, event('verification', { commit: changed, spec, suite, outcome: 'pass', receipt: digest('new'), activeMs: 1 }));
  assert.throws(() => transition(run, event('authorize-publication', { commit: changed, spec, suite, receipt: run.receipt, actor: 'human', approvalRef: 'premature' })), /state/);
  run = transition(run, event('review', { commit: changed, outcome: 'pass', activeMs: 1 }));
  assert.equal(run.reviewCommit, changed);
  assert.throws(() => transition(run, event('authorize-publication', { commit, spec, suite, receipt: previous.receipt, actor: 'human', approvalRef: 'old' })), /exact/);
  run = transition(run, event('authorize-publication', { commit: changed, spec, suite, receipt: run.receipt, actor: 'human', approvalRef: 'new-publication' }));
  assert.equal(transition(run, event('merged', { commit: changed, mergeCommit: 'c'.repeat(40), actor: 'human' })).state, 'merged');
});

test('contract revision requires a changed specification and returns to independent approval and tests', () => {
  const previous = reviewed(staged(), true); const nextSpec = digest('new contract'); const nextCommit = 'b'.repeat(40);
  const data = { commit: nextCommit, scope: 'contract', actor: 'human', approvalRef: 'human-contract', spec: nextSpec, specCommit: 'd'.repeat(40) };
  assert.throws(() => transition(previous, event('revise', { ...data, spec: undefined })), /spec|hash/);
  assert.throws(() => transition(previous, event('revise', { ...data, spec })), /changed|new/);
  const run = transition(previous, event('revise', data));
  assert.equal(run.state, 'spec-drafted'); assert.equal(run.spec, nextSpec); assert.equal(run.revisions, 1);
  for (const key of ['suite', 'commit', 'approvalRef', 'verification', 'receipt', 'reviewCommit', 'publicationRef', 'repairReceipt'] as const) assert.equal(run[key], undefined);
  assert.throws(() => transition(run, event('begin-build')), /state/);
  assert.throws(() => transition(run, event('stage-tests', { spec: nextSpec, suite, activeMs: 0 })), /state/);
});

test('a revised descendant that reverses verified behavior cannot inherit earlier merge evidence', () => {
  const prior = reviewed(staged(), true); const descendant = 'f'.repeat(40);
  let run = transition(prior, event('revise', { commit: descendant, scope: 'implementation', actor: 'human', approvalRef: 'human-reversal-review' }));
  run = transition(run, event('verification', { commit: descendant, spec, suite, outcome: 'fail', receipt: digest('failed reversed behavior'), activeMs: 0 }));
  run = transition(run, event('review', { commit: descendant, outcome: 'pass', activeMs: 0 }));
  assert.equal(run.state, 'repair'); assert.equal(run.reviewCommit, undefined);
  assert.throws(() => transition(run, event('authorize-publication', { commit: descendant, spec, suite, receipt: prior.receipt, actor: 'human', approvalRef: 'old-pass' })), /state/);
  assert.throws(() => transition(run, event('merged', { commit: descendant, mergeCommit: 'e'.repeat(40), actor: 'human' })), /state/);
});

test('revision rejects unchanged candidates, missing approved suites, wrong actors and exhausted budgets', () => {
  let run = reviewed(staged(), true);
  const revise = (candidate: string, extra = {}) => event('revise', { commit: candidate, scope: 'implementation', actor: 'human', approvalRef: 'decision', ...extra });
  assert.throws(() => transition(run, revise(commit)), /changed/);
  assert.throws(() => transition({ ...run, suite: undefined } as unknown as Run, revise('b'.repeat(40))), /suite|approved/);
  assert.throws(() => transition(run, revise('b'.repeat(40), { actor: 'agent' })), /human/);
  run = transition(run, event('pause', { reason: 'review wait', activeMs: 0 }));
  assert.equal(run.resumeState, 'human-merge-review');
  run = transition(run, revise('b'.repeat(40)));
  assert.equal(run.state, 'verifying'); assert.equal(run.resumeState, undefined);
  for (let revision = 1; revision <= POLICY.maxRevisions; revision++) {
    const current = run.commit!;
    run = transition(run, event('verification', { commit: current, spec, suite, outcome: 'pass', receipt: digest(`receipt-${revision}`), activeMs: 0 }));
    run = transition(run, event('review', { commit: current, outcome: 'pass', activeMs: 0 }));
    if (revision < POLICY.maxRevisions) run = transition(run, revise('c'.repeat(40)));
  }
  assert.equal(run.revisions, 2); assert.throws(() => transition(run, revise('d'.repeat(40))), /revision.*budget|revisions.*exhausted/);
  assert.throws(() => transition(transition(run, event('cancel')), revise('d'.repeat(40))), /terminal/);
  const exhausted = transition({ ...reviewed(staged(), true), activeMs: POLICY.activeTimeoutMs, repairs: POLICY.maxRepairs }, revise('e'.repeat(40)));
  assert.equal(exhausted.state, 'paused'); assert.equal(exhausted.resumeState, 'verifying'); assert.equal(exhausted.repairs, POLICY.maxRepairs);
});
test('active time limit pauses work without losing its recovery state', () => {
  let run = transition(staged(), event('begin-build'));
  run = transition(run, event('candidate', { commit, activeMs: 3600001 }));
  assert.equal(run.state, 'paused');
  assert.equal(run.resumeState, 'verifying');
  assert.throws(() => transition(run, event('resume')), /budget/);
});
