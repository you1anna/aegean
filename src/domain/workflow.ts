import { assertHash } from './digest.js';
import { POLICY } from './workflow-policy.js';
import { FINDING_OWNERS, type FindingOwner } from './config.js';
import { STOP_REASONS, assertRunPolicy, isTerminal, type Event, type EventType, type Run, type State } from './run.js';

type EventOf<T extends EventType> = Extract<Event, { type: T }>;
type Handler<T extends EventType> = (run: Run, event: EventOf<T>) => void;
type OptionalField = { [K in keyof Run]-?: object extends Pick<Run, K> ? K : never }[keyof Run];

/** States in which active time does not pause the run: it already waits, or the human holds it. */
const ACTIVE_BUDGET_EXEMPT: readonly State[] = ['paused', 'human-merge-review', 'merged'];

/**
 * Apply one event to a run and return the next run. The function does not change `previous`.
 * A repeated event returns `previous` itself. An invalid event throws and records nothing.
 */
export function transition(previous: Run, event: Event): Run {
  if (event.type !== 'cancel') assertRunPolicy(previous);
  if (previous.events.includes(event.id)) return previous;
  if (isTerminal(previous.state)) throw new Error(`terminal state ${previous.state}`);
  if (!event.id || !Number.isSafeInteger(event.at) || event.at < previous.updatedAt) throw new Error('invalid event identity or time');
  const run = structuredClone(previous);
  addActiveTime(run, event);
  apply(run, event);
  if (run.activeMs >= POLICY.activeTimeoutMs && !isTerminal(run.state) && !ACTIVE_BUDGET_EXEMPT.includes(run.state)) pauseRun(run, 'active budget exhausted');
  run.events.push(event.id); run.updatedAt = event.at;
  return run;
}

function addActiveTime(run: Run, event: Event): void {
  if (!('activeMs' in event)) return;
  if (event.activeMs === undefined || !Number.isSafeInteger(event.activeMs) || event.activeMs < 0) throw new Error('invalid active duration');
  run.activeMs += event.activeMs;
  if (!Number.isSafeInteger(run.activeMs)) throw new Error('invalid active duration');
}

function apply(run: Run, event: Event): void {
  if (typeof event.type !== 'string' || !Object.hasOwn(HANDLERS, event.type)) throw new Error('unknown workflow event');
  (HANDLERS[event.type] as (run: Run, event: Event) => void)(run, event);
}

const HANDLERS: { readonly [T in EventType]: Handler<T> } = {
  draft(run, event) {
    requireState(run, 'requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair');
    assertHash(event.spec); run.spec = event.spec; run.state = 'spec-drafted';
    if (event.specCommit) { assertHash(event.specCommit, 40); run.specCommit = event.specCommit; } else delete run.specCommit;
    clear(run, 'suite', 'commit', 'approvalRef', 'publicationRef', 'verification', 'receipt', 'repairReceipt', 'reviewCommit');
  },

  approve(run, event) {
    requireState(run, 'spec-drafted');
    if (event.spec !== run.spec || (run.specCommit && event.specCommit !== run.specCommit) || event.actor !== 'human' || !event.approvalRef) throw new Error('approval must reference the exact spec, published commit and human receipt');
    run.approvalRef = event.approvalRef; run.state = 'spec-approved';
  },

  'stage-tests'(run, event) {
    requireState(run, 'spec-approved');
    if (event.spec !== run.spec) throw new Error('stale spec for suite');
    assertHash(event.suite); run.suite = event.suite; run.state = 'tests-staged';
  },

  'baseline-inconclusive'(run, event) {
    requireState(run, 'tests-staged');
    if (!run.suite || event.suite !== run.suite) throw new Error('stale base commit evidence');
    if (allowInfrastructureRetry(run)) pauseRun(run, event.reason);
  },

  'begin-build'(run, event) {
    requireState(run, 'tests-staged', 'repair');
    if (run.state === 'tests-staged') {
      const baseline = event.baseline;
      if (!baseline || baseline.suite !== run.suite) throw new Error('building requires base commit results for the staged suite');
      if (!Number.isSafeInteger(baseline.cases) || !Number.isSafeInteger(baseline.passed) || baseline.cases < 1 || baseline.passed < 0 || baseline.passed > baseline.cases) throw new Error('invalid base commit results');
      // A test that passes before the change cannot show that the change works.
      if (baseline.passed === baseline.cases) { escalateRun(run, STOP_REASONS.baseline); return; }
    } else if (event.baseline !== undefined) throw new Error('a repair uses the base commit results of its staged suite');
    if (run.state === 'repair' && run.receipt) run.repairReceipt = run.receipt;
    run.state = 'building';
    clear(run, 'verification', 'receipt', 'reviewCommit', 'publicationRef');
  },

  candidate(run, event) {
    requireState(run, 'building');
    assertHash(event.commit, 40); run.commit = event.commit;
    clear(run, 'repairReceipt', 'publicationRef');
    run.state = 'verifying';
  },

  verification(run, event) {
    requireState(run, 'verifying');
    if (event.spec !== run.spec || event.suite !== run.suite || event.commit !== run.commit) throw new Error('stale verification evidence');
    assertHash(event.receipt);
    if (event.outcome === 'inconclusive') allowInfrastructureRetry(run);
    else { run.verification = event.outcome; run.receipt = event.receipt; run.state = 'reviewing'; }
  },

  review(run, event) {
    requireState(run, 'reviewing');
    if (!run.commit || event.commit !== run.commit) throw new Error('stale review commit');
    const owners = event.findings;
    if (!isFindingCounts(owners)) throw new Error('review requires a finding count for each owner');
    // A fault in the specification or in Aegean goes to the human; it never becomes a Builder repair.
    if (owners.spec > 0) escalateRun(run, STOP_REASONS.spec);
    else if (owners.factory > 0) escalateRun(run, STOP_REASONS.factory);
    else if (event.outcome === 'pass' && run.verification === 'pass' && owners.builder === 0) { run.state = 'human-merge-review'; run.reviewCommit = event.commit; }
    else if (event.outcome !== 'escalate' && run.repairs < POLICY.maxRepairs) { run.repairs++; run.state = 'repair'; }
    else escalateRun(run, event.outcome === 'escalate' ? 'independent review escalation' : 'repair attempts exhausted');
  },

  'authorize-publication'(run, event) {
    requireState(run, 'human-merge-review');
    if (event.actor !== 'human' || !event.approvalRef || !hasReviewedEvidence(run) || event.commit !== run.commit || event.spec !== run.spec || event.suite !== run.suite || event.receipt !== run.receipt) throw new Error('publication approval must bind exact verified and reviewed evidence');
    run.publicationRef = event.approvalRef;
  },

  revise(run, event) {
    if (run.state !== 'human-merge-review' && !(run.state === 'paused' && run.resumeState === 'human-merge-review')) throw new Error('revision requires human merge review');
    if (event.actor !== 'human' || !event.approvalRef) throw new Error('revision requires an explicit human decision');
    if (run.revisions >= POLICY.maxRevisions) throw new Error('revision budget exhausted; requires a new human decision');
    assertHash(event.commit, 40);
    if (!run.commit || event.commit === run.commit) throw new Error('revision requires a changed candidate commit');
    if (event.scope === 'implementation') {
      if (!run.spec || !run.suite || !run.approvalRef) throw new Error('implementation revision requires the approved specification and suite');
      if (event.spec !== undefined || event.specCommit !== undefined) throw new Error('implementation revision cannot change its approved contract');
      run.commit = event.commit; run.state = 'verifying';
    } else if (event.scope === 'contract') {
      if (!event.spec || !event.specCommit) throw new Error('contract revision requires a new specification and published commit');
      assertHash(event.spec); assertHash(event.specCommit, 40);
      if (event.spec === run.spec || event.specCommit === run.specCommit) throw new Error('contract revision requires a changed specification and commit');
      run.spec = event.spec; run.specCommit = event.specCommit; run.state = 'spec-drafted';
      clear(run, 'suite', 'commit', 'approvalRef');
    } else throw new Error('invalid revision scope');
    run.revisions++; run.revisionRef = event.approvalRef;
    clear(run, 'verification', 'receipt', 'reviewCommit', 'publicationRef', 'repairReceipt', 'resumeState', 'reason', 'mergeCommit');
  },

  merged(run, event) {
    requireState(run, 'human-merge-review');
    if (event.actor !== 'human' || !run.publicationRef || !hasReviewedEvidence(run) || event.commit !== run.commit) throw new Error('human merge must reference the published exact verified and reviewed commit');
    assertHash(event.mergeCommit, 40); run.mergeCommit = event.mergeCommit; run.state = 'merged';
  },

  archive(run) { requireState(run, 'merged'); run.state = 'archived'; },

  cancel(run) { run.state = 'cancelled'; },

  pause(run, event) {
    requireState(run, 'building', 'verifying', 'reviewing', 'requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair', 'human-merge-review');
    pauseRun(run, event.reason);
  },

  resume(run) {
    requireState(run, 'paused');
    if (run.activeMs >= POLICY.activeTimeoutMs) throw new Error('active budget exhausted; requires a new human decision');
    if (!run.resumeState) throw new Error('missing resume state');
    run.state = run.resumeState;
    clear(run, 'resumeState', 'reason');
  },
};

function requireState(run: Run, ...states: State[]): void {
  if (!states.includes(run.state)) throw new Error(`invalid state ${run.state}; expected ${states.join(', ')}`);
}
/** Remove evidence that the event makes stale. Each event names its own fields. */
function clear(run: Run, ...fields: OptionalField[]): void {
  for (const field of fields) delete run[field];
}
function escalateRun(run: Run, reason: string): void {
  run.state = 'escalated'; run.reason = reason;
}
function pauseRun(run: Run, reason: string): void {
  run.resumeState = run.state; run.state = 'paused'; run.reason = reason;
}
function allowInfrastructureRetry(run: Run): boolean {
  if (run.infrastructureRetries >= POLICY.maxInfrastructureRetries) { escalateRun(run, 'infrastructure retries exhausted'); return false; }
  run.infrastructureRetries++; return true;
}
function isFindingCounts(owners: unknown): owners is Record<FindingOwner, number> {
  if (!owners || typeof owners !== 'object') return false;
  const counts = owners as Record<string, unknown>;
  return Object.keys(counts).length === FINDING_OWNERS.length && FINDING_OWNERS.every(owner => Number.isSafeInteger(counts[owner]) && (counts[owner] as number) >= 0);
}
/** The candidate passed verification and a review of the same commit. */
function hasReviewedEvidence(run: Run): boolean {
  return !!run.commit && run.verification === 'pass' && run.reviewCommit === run.commit && !!run.spec && !!run.suite && !!run.receipt;
}
