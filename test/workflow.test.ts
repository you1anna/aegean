import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, STOP_REASONS, TERMINAL_STATES, type Event, type EventType, type Run, type State } from '../src/domain/run.js';
import { transition } from '../src/domain/workflow.js';
import { digest } from '../src/domain/digest.js';
import { POLICY, POLICY_IDENTITY, policyIdentityFor, policyFromToolchain } from '../src/domain/workflow-policy.js';
import { ProjectSchema, assertVerifierEntryPoint } from '../src/domain/config.js';
import toolchain from '../toolchain.json' with { type: 'json' };
import { frozenProject, syntheticRun, workflowEvent as event } from './helpers/runs.js';

const spec = digest('approved requirement');
const suite = digest('independent suite');
const commit = 'a'.repeat(40);
const frozen = frozenProject();
const start = () => syntheticRun({ frozen });
const none = { builder: 0, spec: 0, factory: 0 };
const baseline = { suite, cases: 2, passed: 1 };
const build = (run: Run) => transition(run, event('begin-build', { baseline }));
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
  run = transition(run, event('begin-build', run.state === 'tests-staged' ? { baseline, activeMs: 5 } : {}));
  run = transition(run, event('candidate', { commit, activeMs: 10 }));
  run = transition(run, event('verification', { commit, spec, suite, outcome: passed ? 'pass' : 'fail', receipt: digest('receipt'), activeMs: 10 }));
  return transition(run, event('review', { commit, outcome: passed ? 'pass' : 'repair', findings: none, activeMs: 10 }));
}
test('human approval and independent suite are required before building', () => {
  assert.throws(() => transition(start(), event('begin-build')), /state/);
  const drafted = transition(start(), event('draft', { spec }));
  assert.throws(() => transition(drafted, event('approve', { spec: digest('changed'), actor: 'human', approvalRef: 'url' })), /spec/);
  assert.throws(() => transition(drafted, event('stage-tests', { suite, spec })), /state/);
  assert.equal(staged().state, 'tests-staged');
});
test('stale commit, spec and suite cannot produce a passing gate', () => {
  let run = build(staged());
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
  let run = build(staged());
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
  // Protected cases compare the complete stdout of the verifier command. A project check is a test runner whose output has timings, so no case could pass.
  assert.doesNotThrow(() => assertVerifierEntryPoint(project));
  assert.throws(() => assertVerifierEntryPoint(ProjectSchema.parse({ ...configuration, verifier: { ...configuration.verifier, command: ['node', '--test'] } })), /verifier\.command is also a project check/);
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
  run = transition(run, event('review', { commit: changed, outcome: 'pass', findings: none, activeMs: 1 }));
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
  run = transition(run, event('review', { commit: descendant, outcome: 'pass', findings: none, activeMs: 0 }));
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
    run = transition(run, event('review', { commit: current, outcome: 'pass', findings: none, activeMs: 0 }));
    if (revision < POLICY.maxRevisions) run = transition(run, revise('c'.repeat(40)));
  }
  assert.equal(run.revisions, 2); assert.throws(() => transition(run, revise('d'.repeat(40))), /revision.*budget|revisions.*exhausted/);
  assert.throws(() => transition(transition(run, event('cancel')), revise('d'.repeat(40))), /terminal/);
  const exhausted = transition({ ...reviewed(staged(), true), activeMs: POLICY.activeTimeoutMs, repairs: POLICY.maxRepairs }, revise('e'.repeat(40)));
  assert.equal(exhausted.state, 'paused'); assert.equal(exhausted.resumeState, 'verifying'); assert.equal(exhausted.repairs, POLICY.maxRepairs);
});
test('active time limit pauses work without losing its recovery state', () => {
  let run = build(staged());
  run = transition(run, event('candidate', { commit, activeMs: 3600001 }));
  assert.equal(run.state, 'paused');
  assert.equal(run.resumeState, 'verifying');
  assert.throws(() => transition(run, event('resume')), /budget/);
});

test('building requires base commit results for the staged suite and stops when every test already passes', () => {
  assert.throws(() => transition(staged(), event('begin-build')), /base commit results/);
  assert.throws(() => transition(staged(), event('begin-build', { baseline: { ...baseline, suite: digest('stale suite') } })), /base commit results/);
  for (const invalid of [{ cases: 0, passed: 0 }, { cases: 2, passed: 3 }, { cases: 2, passed: -1 }, { cases: 1.5, passed: 0 }]) {
    assert.throws(() => transition(staged(), event('begin-build', { baseline: { suite, ...invalid } })), /invalid base commit results/);
  }
  const building = transition(staged(), event('begin-build', { baseline, activeMs: 7 }));
  assert.equal(building.state, 'building'); assert.equal(building.activeMs, 7);
  const vacuous = transition(staged(), event('begin-build', { baseline: { suite, cases: 2, passed: 2 }, activeMs: 7 }));
  assert.equal(vacuous.state, 'escalated'); assert.equal(vacuous.reason, STOP_REASONS.baseline); assert.equal(vacuous.repairs, 0); assert.equal(vacuous.activeMs, 7);
  const repairing = reviewed(staged(), false);
  assert.equal(repairing.state, 'repair');
  assert.throws(() => transition(repairing, event('begin-build', { baseline })), /repair/);
  assert.equal(transition(repairing, event('begin-build')).state, 'building');
});

function verifiedRun(passed: boolean): Run {
  let run = build(staged());
  run = transition(run, event('candidate', { commit, activeMs: 1 }));
  return transition(run, event('verification', { commit, spec, suite, outcome: passed ? 'pass' : 'fail', receipt: digest('receipt'), activeMs: 1 }));
}
test('a review finding goes to its owner: the Builder repairs, the specification and Aegean stop the run', () => {
  const review = (run: Run, outcome: string, findings: Record<string, number>) => transition(run, event('review', { commit, outcome, findings, activeMs: 1 }));
  const builder = review(verifiedRun(false), 'repair', { ...none, builder: 2 });
  assert.equal(builder.state, 'repair'); assert.equal(builder.repairs, 1);
  const specFault = review(verifiedRun(false), 'repair', { ...none, builder: 1, spec: 1, factory: 1 });
  assert.equal(specFault.state, 'escalated'); assert.equal(specFault.reason, STOP_REASONS.spec); assert.equal(specFault.repairs, 0);
  const factoryFault = review(verifiedRun(false), 'repair', { ...none, builder: 1, factory: 1 });
  assert.equal(factoryFault.state, 'escalated'); assert.equal(factoryFault.reason, STOP_REASONS.factory); assert.equal(factoryFault.repairs, 0);
  const unexplained = review(verifiedRun(false), 'pass', none);
  assert.equal(unexplained.state, 'repair');
  for (const [owner, reason] of [['spec', STOP_REASONS.spec], ['factory', STOP_REASONS.factory]] as const) {
    const fault = review(verifiedRun(true), 'pass', { ...none, [owner]: 1 });
    assert.equal(fault.state, 'escalated'); assert.equal(fault.reason, reason); assert.equal(fault.repairs, 0);
    assert.equal(fault.reviewCommit, undefined);
  }
  assert.equal(review(verifiedRun(true), 'pass', { ...none, builder: 1 }).state, 'repair');
  assert.equal(review(verifiedRun(true), 'escalate', none).reason, 'independent review escalation');
  for (const findings of [undefined, { builder: 1, spec: 0 }, { ...none, builder: -1 }, { ...none, extra: 0 }]) {
    assert.throws(() => transition(verifiedRun(false), event('review', { commit, outcome: 'repair', findings, activeMs: 1 })), /finding count/);
  }
});

test('base commit infrastructure failures share the retry budget and retain an idempotent recovery checkpoint', () => {
  const fail = () => event('baseline-inconclusive', { suite, reason: 'base verifier unavailable', activeMs: 7 });
  const first = fail();
  let run = transition(staged(), first);
  assert.equal(run.state, 'paused'); assert.equal(run.resumeState, 'tests-staged');
  assert.equal(run.infrastructureRetries, 1); assert.equal(run.repairs, 0); assert.equal(run.activeMs, 7);
  assert.deepEqual(transition(run, first), run);
  run = transition(run, event('resume'));
  assert.throws(() => transition(run, { ...fail(), suite: digest('stale') } as Event), /stale/);
  const retried = transition(run, fail());
  assert.equal(retried.state, 'escalated'); assert.equal(retried.reason, 'infrastructure retries exhausted');
  assert.equal(retried.activeMs, 14); assert.equal(retried.repairs, 0);
  assert.throws(() => transition(retried, event('resume')), /terminal/);
  let candidate = transition(build(run), event('candidate', { commit, activeMs: 0 }));
  candidate = transition(candidate, event('verification', { commit, spec, suite, outcome: 'inconclusive', receipt: digest('infra'), activeMs: 0 }));
  assert.equal(candidate.state, 'escalated');
  assert.throws(() => transition(build(staged()), fail()), /state/);
});

const evidence = { spec, specCommit: commit, suite, commit, mergeCommit: 'e'.repeat(40), approvalRef: 'approval', publicationRef: 'publication', verification: 'pass', receipt: digest('receipt'), repairReceipt: digest('repair receipt'), revisionRef: 'revision', reviewCommit: commit } as const;
const withEvidence = (state: State, extra: Partial<Run> = {}): Run => ({ ...start(), ...evidence, state, ...extra });
const evidenceFields = (run: Run) => Object.keys(run).filter(key => !Object.hasOwn(start(), key)).sort();
test('each event clears exactly the evidence that it makes stale', () => {
  const changed = 'f'.repeat(40);
  const cases: [string, Run, Event, string[]][] = [
    ['draft with a published commit', withEvidence('repair'), event('draft', { spec: digest('next'), specCommit: changed }), ['mergeCommit', 'revisionRef', 'spec', 'specCommit']],
    ['draft without a published commit', withEvidence('spec-drafted'), event('draft', { spec: digest('next') }), ['mergeCommit', 'revisionRef', 'spec']],
    ['repair build', withEvidence('repair'), event('begin-build'), ['approvalRef', 'commit', 'mergeCommit', 'repairReceipt', 'revisionRef', 'spec', 'specCommit', 'suite']],
    ['candidate', withEvidence('building'), event('candidate', { commit: changed, activeMs: 0 }), ['approvalRef', 'commit', 'mergeCommit', 'receipt', 'reviewCommit', 'revisionRef', 'spec', 'specCommit', 'suite', 'verification']],
    ['implementation revision', withEvidence('paused', { resumeState: 'human-merge-review', reason: 'wait' }), event('revise', { commit: changed, scope: 'implementation', actor: 'human', approvalRef: 'next' }), ['approvalRef', 'commit', 'revisionRef', 'spec', 'specCommit', 'suite']],
    ['contract revision', withEvidence('human-merge-review'), event('revise', { commit: changed, scope: 'contract', actor: 'human', approvalRef: 'next', spec: digest('next'), specCommit: 'd'.repeat(40) }), ['revisionRef', 'spec', 'specCommit']],
    ['resume', withEvidence('paused', { resumeState: 'verifying', reason: 'wait' }), event('resume'), Object.keys(evidence).sort()],
  ];
  for (const [name, run, next, kept] of cases) assert.deepEqual(evidenceFields(transition(run, next)), kept, name);
  assert.equal(transition(withEvidence('repair'), event('begin-build')).repairReceipt, evidence.receipt);
});

const ACCEPTED_IN: Record<EventType, readonly State[]> = {
  draft: ['requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair'],
  approve: ['spec-drafted'],
  'stage-tests': ['spec-approved'],
  'baseline-inconclusive': ['tests-staged'],
  'begin-build': ['tests-staged', 'repair'],
  candidate: ['building'],
  verification: ['verifying'],
  review: ['reviewing'],
  'authorize-publication': ['human-merge-review'],
  revise: ['human-merge-review', 'paused'],
  merged: ['human-merge-review'],
  archive: ['merged'],
  cancel: ['requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair', 'human-merge-review', 'merged', 'paused'],
  pause: ['requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair', 'human-merge-review'],
  resume: ['paused'],
};
test('each event is accepted only in its own states, and a terminal run accepts none', () => {
  const sample: Record<EventType, Record<string, unknown>> = {
    draft: { spec: digest('next') }, approve: { spec, specCommit: commit, actor: 'human', approvalRef: 'approval' }, 'stage-tests': { spec, suite, activeMs: 0 },
    'baseline-inconclusive': { suite, reason: 'unavailable', activeMs: 0 }, 'begin-build': {}, candidate: { commit: 'f'.repeat(40), activeMs: 0 },
    verification: { commit, spec, suite, outcome: 'pass', receipt: evidence.receipt, activeMs: 0 }, review: { commit, outcome: 'pass', findings: none, activeMs: 0 },
    'authorize-publication': { commit, spec, suite, receipt: evidence.receipt, actor: 'human', approvalRef: 'publication' },
    revise: { commit: 'f'.repeat(40), scope: 'implementation', actor: 'human', approvalRef: 'revision' }, merged: { commit, mergeCommit: 'e'.repeat(40), actor: 'human' },
    archive: {}, cancel: {}, pause: { reason: 'wait', activeMs: 0 }, resume: {},
  };
  const refusal = (run: Run, next: Event): string | undefined => { try { transition(run, next); return undefined; } catch (error) { return (error as Error).message; } };
  for (const type of Object.keys(ACCEPTED_IN) as EventType[]) {
    for (const state of STATES) {
      const run = withEvidence(state, state === 'paused' ? { resumeState: 'human-merge-review', reason: 'wait' } : {});
      const message = refusal(run, event(type, sample[type])) ?? '';
      if (TERMINAL_STATES.includes(state)) assert.match(message, /^terminal state/, `${type} in ${state}`);
      else assert.equal(/^invalid state|^revision requires human merge review/.test(message), !ACCEPTED_IN[type].includes(state), `${type} in ${state}: ${message}`);
    }
  }
});

test('a repeated event returns the same run, and no transition changes its input', () => {
  const draft = event('draft', { spec });
  const drafted = transition(start(), draft);
  assert.equal(transition(drafted, draft), drafted);
  const cancel = event('cancel'); const cancelled = transition(drafted, cancel);
  assert.equal(transition(cancelled, cancel), cancelled);
  const before = structuredClone(drafted);
  transition(drafted, event('approve', { spec, actor: 'human', approvalRef: 'approval' }));
  assert.throws(() => transition(drafted, event('stage-tests', { spec, suite, activeMs: 0 })), /state/);
  assert.deepEqual(drafted, before);
});

test('an event type outside the workflow is refused, including inherited object keys', () => {
  const run = start(); const before = structuredClone(run);
  for (const type of ['unknown', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => transition(run, event(type as EventType)), /unknown workflow event/, type);
  }
  assert.deepEqual(run, before);
});
