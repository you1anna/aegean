import { createHash } from 'node:crypto';
import toolchain from '../../toolchain.json' with { type: 'json' };

export const POLICY = Object.freeze({ version: toolchain.policy, maxRepairs: toolchain.maxRepairs, maxInfrastructureRetries: toolchain.maxInfrastructureRetries, activeTimeoutMs: toolchain.activeTimeoutMs });
export const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
export const POLICY_IDENTITY = digest(JSON.stringify(POLICY));
export type State = 'requested' | 'spec-drafted' | 'spec-approved' | 'tests-staged' | 'building' | 'verifying' | 'reviewing' | 'repair' | 'human-merge-review' | 'merged' | 'archived' | 'paused' | 'escalated' | 'cancelled';
export interface Run {
  schemaVersion: 1; id: string; host: string; repository: string; policy: string; policyIdentity: string;
  state: State; createdAt: number; updatedAt: number; events: string[];
  repairs: number; infrastructureRetries: number; activeMs: number;
  spec?: string; specCommit?: string; suite?: string; commit?: string; mergeCommit?: string;
  approvalRef?: string; publicationRef?: string; verification?: 'pass' | 'fail'; receipt?: string; repairReceipt?: string;
  resumeState?: State; reason?: string;
}
interface BaseEvent { id: string; at: number }
export type Event = BaseEvent & (
  | { type: 'draft'; spec: string; specCommit?: string }
  | { type: 'approve'; spec: string; specCommit?: string; actor: 'human'; approvalRef: string }
  | { type: 'stage-tests'; spec: string; suite: string; activeMs: number }
  | { type: 'begin-build' }
  | { type: 'candidate'; commit: string; activeMs: number }
  | { type: 'verification'; commit: string; spec: string; suite: string; outcome: 'pass' | 'fail' | 'inconclusive'; receipt: string; activeMs: number }
  | { type: 'review'; commit: string; outcome: 'pass' | 'repair' | 'escalate'; activeMs: number }
  | { type: 'authorize-publication'; commit: string; spec: string; suite: string; receipt: string; actor: 'human'; approvalRef: string }
  | { type: 'merged'; commit: string; mergeCommit: string; actor: 'human' }
  | { type: 'archive' | 'cancel' | 'resume' }
  | { type: 'pause'; reason: string; activeMs: number }
);
export function createRun(id: string, host: string, repository: string, policy: string, now: number): Run {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !host || !repository || policy !== POLICY.version) throw new Error('invalid run identity or unsupported policy');
  return { schemaVersion: 1, id, host, repository, policy, policyIdentity: POLICY_IDENTITY, state: 'requested', createdAt: now, updatedAt: now, events: [], repairs: 0, infrastructureRetries: 0, activeMs: 0 };
}
export function assertRunPolicy(run: Run): void {
  if (run.policy !== POLICY.version || run.policyIdentity !== POLICY_IDENTITY) throw new Error('run policy differs from installed policy; use its original release or cancel; no implicit migration');
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
  if (!event.id || !Number.isFinite(event.at) || event.at < previous.createdAt) throw new Error('invalid event identity or time');
  const run = structuredClone(previous);
  if ('activeMs' in event) {
    if (!Number.isSafeInteger(event.activeMs) || event.activeMs < 0) throw new Error('invalid active duration');
    run.activeMs += event.activeMs;
  }
  switch (event.type) {
    case 'draft':
      requireState(run, 'requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair', 'human-merge-review');
      hash(event.spec); run.spec = event.spec; run.state = 'spec-drafted';
      if (event.specCommit) { hash(event.specCommit, 40); run.specCommit = event.specCommit; } else delete run.specCommit;
      delete run.suite; delete run.commit; delete run.approvalRef; delete run.publicationRef; delete run.verification; delete run.receipt; delete run.repairReceipt;
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
      run.state = 'building'; delete run.verification; delete run.receipt; break;
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
      if (event.commit !== run.commit) throw new Error('stale review commit');
      if (event.outcome === 'pass' && run.verification === 'pass') run.state = 'human-merge-review';
      else if (event.outcome !== 'escalate' && run.repairs < POLICY.maxRepairs) { run.repairs++; run.state = 'repair'; }
      else { run.state = 'escalated'; run.reason = event.outcome === 'escalate' ? 'independent review escalation' : 'repair attempts exhausted'; }
      break;
    case 'authorize-publication':
      requireState(run, 'human-merge-review');
      if (event.actor !== 'human' || !event.approvalRef || event.commit !== run.commit || event.spec !== run.spec || event.suite !== run.suite || event.receipt !== run.receipt) throw new Error('publication approval must bind exact verified evidence');
      run.publicationRef = event.approvalRef; break;
    case 'merged':
      requireState(run, 'human-merge-review');
      if (event.actor !== 'human' || event.commit !== run.commit) throw new Error('human merge must reference verified commit');
      hash(event.mergeCommit, 40); run.mergeCommit = event.mergeCommit; run.state = 'merged'; break;
    case 'archive': requireState(run, 'merged'); run.state = 'archived'; break;
    case 'cancel': run.state = 'cancelled'; break;
    case 'pause':
      requireState(run, 'building', 'verifying', 'reviewing', 'requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'repair');
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
