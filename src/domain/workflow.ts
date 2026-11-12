import { createHash } from 'node:crypto';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { ApproverSchema, type Approver } from './config.js';

export const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export interface PolicyPins { policy: string; maxRepairs: number; maxRevisions: number; maxInfrastructureRetries: number; activeTimeoutMs: number }
export function policyFromToolchain(pins: PolicyPins) {
  if (!pins || typeof pins.policy !== 'string' || !/^\d+\.\d+\.\d+$/.test(pins.policy) || [pins.maxRepairs, pins.maxRevisions, pins.maxInfrastructureRetries, pins.activeTimeoutMs].some(value => !Number.isSafeInteger(value) || value < 0) || pins.activeTimeoutMs === 0) throw new Error('invalid workflow policy pins');
  return Object.freeze({ version: pins.policy, maxRepairs: pins.maxRepairs, maxRevisions: pins.maxRevisions, maxInfrastructureRetries: pins.maxInfrastructureRetries, activeTimeoutMs: pins.activeTimeoutMs });
}
export const policyIdentityFor = (pins: PolicyPins): string => digest(JSON.stringify(policyFromToolchain(pins)));
export const POLICY = policyFromToolchain(toolchain);
export const POLICY_IDENTITY = policyIdentityFor(toolchain);
export type State = 'requested' | 'spec-drafted' | 'spec-approved' | 'tests-staged' | 'building' | 'verifying' | 'reviewing' | 'repair' | 'human-merge-review' | 'merged' | 'archived' | 'paused' | 'escalated' | 'cancelled';
export interface Run {
  schemaVersion: 2; id: string; host: string; repository: string; policy: string; policyIdentity: string;
  approver: Approver; projectPolicy: string; revisions: number;
  state: State; createdAt: number; updatedAt: number; events: string[];
  repairs: number; infrastructureRetries: number; activeMs: number;
  spec?: string; specCommit?: string; suite?: string; commit?: string; mergeCommit?: string;
  approvalRef?: string; publicationRef?: string; verification?: 'pass' | 'fail'; receipt?: string; repairReceipt?: string;
  revisionRef?: string; reviewCommit?: string;
  resumeState?: State; reason?: string;
}
export type HistoricalRun = Omit<Run, 'schemaVersion' | 'approver' | 'projectPolicy' | 'revisions' | 'revisionRef' | 'reviewCommit'> & { schemaVersion: 1 };
interface BaseEvent { id: string; at: number }
export type Event = BaseEvent & (
  | { type: 'draft'; spec: string; specCommit?: string; activeMs?: number }
  | { type: 'approve'; spec: string; specCommit?: string; actor: 'human'; approvalRef: string }
  | { type: 'stage-tests'; spec: string; suite: string; activeMs: number }
  | { type: 'begin-build' }
  | { type: 'candidate'; commit: string; activeMs: number }
  | { type: 'verification'; commit: string; spec: string; suite: string; outcome: 'pass' | 'fail' | 'inconclusive'; receipt: string; activeMs: number }
  | { type: 'review'; commit: string; outcome: 'pass' | 'repair' | 'escalate'; activeMs: number }
  | { type: 'authorize-publication'; commit: string; spec: string; suite: string; receipt: string; actor: 'human'; approvalRef: string }
  | { type: 'revise'; commit: string; scope: 'implementation' | 'contract'; actor: 'human'; approvalRef: string; spec?: string; specCommit?: string }
  | { type: 'merged'; commit: string; mergeCommit: string; actor: 'human' }
  | { type: 'archive' | 'cancel' | 'resume' }
  | { type: 'pause'; reason: string; activeMs: number }
);
export function createRun(id: string, host: string, repository: string, policy: string, now: number, frozen: { approver: Approver; projectPolicy: string }): Run {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !host || !repository || policy !== POLICY.version || !Number.isSafeInteger(now) || now < 0) throw new Error('invalid run identity or unsupported policy');
  const approver = ApproverSchema.parse(frozen?.approver); hash(frozen.projectPolicy);
  return { schemaVersion: 2, id, host, repository, policy, policyIdentity: POLICY_IDENTITY, approver, projectPolicy: frozen.projectPolicy, revisions: 0, state: 'requested', createdAt: now, updatedAt: now, events: [], repairs: 0, infrastructureRetries: 0, activeMs: 0 };
}
export function assertRunPolicy(run: Run | HistoricalRun): asserts run is Run {
  if (run.schemaVersion !== 2 || run.policy !== POLICY.version || run.policyIdentity !== POLICY_IDENTITY) throw new Error('run policy differs from installed policy; use its original release or cancel; no implicit migration');
}
const terminal = new Set<State>(['archived', 'cancelled', 'escalated']);
function requireState(run: Run, ...states: State[]): void {
  if (!states.includes(run.state)) throw new Error(`invalid state ${run.state}; expected ${states.join(', ')}`);
}
function hash(value: string, length = 64): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw new Error('invalid artifact hash');
}
export function transition(previous: Run, event: Event): Run {
  if (event.type !== 'cancel') assertRunPolicy(previous);
  if (previous.events.includes(event.id)) return previous;
  if (terminal.has(previous.state)) throw new Error(`terminal state ${previous.state}`);
  if (!event.id || !Number.isSafeInteger(event.at) || event.at < previous.updatedAt) throw new Error('invalid event identity or time');
  const run = structuredClone(previous);
  if ('activeMs' in event) {
    if (event.activeMs === undefined || !Number.isSafeInteger(event.activeMs) || event.activeMs < 0) throw new Error('invalid active duration');
    run.activeMs += event.activeMs;
    if (!Number.isSafeInteger(run.activeMs)) throw new Error('invalid active duration');
  }
  switch (event.type) {
    case 'draft':
      requireState(run, 'requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair');
      hash(event.spec); run.spec = event.spec; run.state = 'spec-drafted';
      if (event.specCommit) { hash(event.specCommit, 40); run.specCommit = event.specCommit; } else delete run.specCommit;
      delete run.suite; delete run.commit; delete run.approvalRef; delete run.publicationRef; delete run.verification; delete run.receipt; delete run.repairReceipt; delete run.reviewCommit;
      break;
    case 'approve':
      requireState(run, 'spec-drafted');
      if (event.spec !== run.spec || (run.specCommit && event.specCommit !== run.specCommit) || event.actor !== 'human' || !event.approvalRef) throw new Error('approval must reference the exact spec, published commit and human receipt');
      run.approvalRef = event.approvalRef; run.state = 'spec-approved'; break;
    case 'stage-tests':
      requireState(run, 'spec-approved');
      if (event.spec !== run.spec) throw new Error('stale spec for suite');
      hash(event.suite); run.suite = event.suite; run.state = 'tests-staged'; break;
    case 'begin-build':
      requireState(run, 'tests-staged', 'repair');
      if (run.state === 'repair' && run.receipt) run.repairReceipt = run.receipt;
      run.state = 'building'; delete run.verification; delete run.receipt; delete run.reviewCommit; delete run.publicationRef; break;
    case 'candidate':
      requireState(run, 'building'); hash(event.commit, 40); run.commit = event.commit; delete run.repairReceipt; delete run.publicationRef; run.state = 'verifying'; break;
    case 'verification':
      requireState(run, 'verifying');
      if (event.spec !== run.spec || event.suite !== run.suite || event.commit !== run.commit) throw new Error('stale verification evidence');
      hash(event.receipt);
      if (event.outcome === 'inconclusive') {
        if (run.infrastructureRetries >= POLICY.maxInfrastructureRetries) { run.state = 'escalated'; run.reason = 'infrastructure retries exhausted'; }
        else run.infrastructureRetries++;
      } else { run.verification = event.outcome; run.receipt = event.receipt; run.state = 'reviewing'; }
      break;
    case 'review':
      requireState(run, 'reviewing');
      if (!run.commit || event.commit !== run.commit) throw new Error('stale review commit');
      if (event.outcome === 'pass' && run.verification === 'pass') { run.state = 'human-merge-review'; run.reviewCommit = event.commit; }
      else if (event.outcome !== 'escalate' && run.repairs < POLICY.maxRepairs) { run.repairs++; run.state = 'repair'; }
      else { run.state = 'escalated'; run.reason = event.outcome === 'escalate' ? 'independent review escalation' : 'repair attempts exhausted'; }
      break;
    case 'authorize-publication':
      requireState(run, 'human-merge-review');
      if (event.actor !== 'human' || !event.approvalRef || !run.commit || run.verification !== 'pass' || run.reviewCommit !== run.commit || !run.spec || !run.suite || !run.receipt || event.commit !== run.commit || event.spec !== run.spec || event.suite !== run.suite || event.receipt !== run.receipt) throw new Error('publication approval must bind exact verified and reviewed evidence');
      run.publicationRef = event.approvalRef; break;
    case 'revise': {
      if (run.state !== 'human-merge-review' && !(run.state === 'paused' && run.resumeState === 'human-merge-review')) throw new Error('revision requires human merge review');
      if (event.actor !== 'human' || !event.approvalRef) throw new Error('revision requires an explicit human decision');
      if (run.revisions >= POLICY.maxRevisions) throw new Error('revision budget exhausted; requires a new human decision');
      hash(event.commit, 40);
      if (!run.commit || event.commit === run.commit) throw new Error('revision requires a changed candidate commit');
      if (event.scope === 'implementation') {
        if (!run.spec || !run.suite || !run.approvalRef) throw new Error('implementation revision requires the approved specification and suite');
        if (event.spec !== undefined || event.specCommit !== undefined) throw new Error('implementation revision cannot change its approved contract');
        run.commit = event.commit; run.state = 'verifying';
      } else if (event.scope === 'contract') {
        if (!event.spec || !event.specCommit) throw new Error('contract revision requires a new specification and published commit');
        hash(event.spec); hash(event.specCommit, 40);
        if (event.spec === run.spec || event.specCommit === run.specCommit) throw new Error('contract revision requires a changed specification and commit');
        run.spec = event.spec; run.specCommit = event.specCommit; run.state = 'spec-drafted';
        delete run.suite; delete run.commit; delete run.approvalRef;
      } else throw new Error('invalid revision scope');
      run.revisions++; run.revisionRef = event.approvalRef;
      delete run.verification; delete run.receipt; delete run.reviewCommit; delete run.publicationRef; delete run.repairReceipt;
      delete run.resumeState; delete run.reason; delete run.mergeCommit;
      break;
    }
    case 'merged':
      requireState(run, 'human-merge-review');
      if (event.actor !== 'human' || !run.publicationRef || !run.commit || run.verification !== 'pass' || run.reviewCommit !== run.commit || !run.spec || !run.suite || !run.receipt || event.commit !== run.commit) throw new Error('human merge must reference the published exact verified and reviewed commit');
      hash(event.mergeCommit, 40); run.mergeCommit = event.mergeCommit; run.state = 'merged'; break;
    case 'archive': requireState(run, 'merged'); run.state = 'archived'; break;
    case 'cancel': run.state = 'cancelled'; break;
    case 'pause':
      requireState(run, 'building', 'verifying', 'reviewing', 'requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair', 'human-merge-review');
      run.resumeState = run.state; run.state = 'paused'; run.reason = event.reason; break;
    case 'resume':
      requireState(run, 'paused');
      if (run.activeMs >= POLICY.activeTimeoutMs) throw new Error('active budget exhausted; requires a new human decision');
      if (!run.resumeState) throw new Error('missing resume state');
      run.state = run.resumeState; delete run.resumeState; delete run.reason; break;
    default: throw new Error('unknown workflow event');
  }
  if (run.activeMs >= POLICY.activeTimeoutMs && !terminal.has(run.state) && !['paused', 'human-merge-review', 'merged'].includes(run.state)) {
    run.resumeState = run.state; run.state = 'paused'; run.reason = 'active budget exhausted';
  }
  run.events.push(event.id); run.updatedAt = event.at;
  return run;
}
