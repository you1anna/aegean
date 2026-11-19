import { assertHash } from './digest.js';
import { POLICY, POLICY_IDENTITY } from './workflow-policy.js';
import { ApproverSchema, type Approver, type FindingOwner } from './config.js';

/** Every run state. The control ledger schema and the guide read this list. */
export const STATES = ['requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair', 'human-merge-review', 'merged', 'archived', 'paused', 'escalated', 'cancelled'] as const;
export type State = typeof STATES[number];
/** A run in one of these states accepts no further event. */
export const TERMINAL_STATES: readonly State[] = ['archived', 'cancelled', 'escalated'];
export const isTerminal = (state: State): boolean => TERMINAL_STATES.includes(state);

/** Fixed reasons for a stop that a check or a finding owner caused. Guidance and tests match them exactly. */
export const STOP_REASONS = {
  baseline: 'every protected test already passed on the base commit',
  spec: 'independent review found a specification fault',
  factory: 'independent review found an Aegean fault',
} as const;
/** Protected suite results on the base commit, counted by test case. */
export interface BaselineCounts { suite: string; cases: number; passed: number }
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
export type HistoricalRun = Omit<Run, 'schemaVersion' | 'approver' | 'projectPolicy' | 'revisions' | 'revisionRef' | 'reviewCommit' | 'policyIdentity'> & { schemaVersion: 1; policyIdentity?: string };
interface BaseEvent { id: string; at: number }
export type Event = BaseEvent & (
  | { type: 'draft'; spec: string; specCommit?: string; activeMs?: number }
  | { type: 'approve'; spec: string; specCommit?: string; actor: 'human'; approvalRef: string }
  | { type: 'stage-tests'; spec: string; suite: string; activeMs: number }
  | { type: 'baseline-inconclusive'; suite: string; reason: string; activeMs: number }
  | { type: 'begin-build'; baseline?: BaselineCounts; activeMs?: number }
  | { type: 'candidate'; commit: string; activeMs: number }
  | { type: 'verification'; commit: string; spec: string; suite: string; outcome: 'pass' | 'fail' | 'inconclusive'; receipt: string; activeMs: number }
  | { type: 'review'; commit: string; outcome: 'pass' | 'repair' | 'escalate'; findings: Record<FindingOwner, number>; activeMs: number }
  | { type: 'authorize-publication'; commit: string; spec: string; suite: string; receipt: string; actor: 'human'; approvalRef: string }
  | { type: 'revise'; commit: string; scope: 'implementation' | 'contract'; actor: 'human'; approvalRef: string; spec?: string; specCommit?: string }
  | { type: 'merged'; commit: string; mergeCommit: string; actor: 'human' }
  | { type: 'archive' }
  | { type: 'cancel' }
  | { type: 'resume' }
  | { type: 'pause'; reason: string; activeMs: number }
);
export type EventType = Event['type'];

export function createRun(id: string, host: string, repository: string, policy: string, now: number, frozen: { approver: Approver; projectPolicy: string }): Run {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !host || !repository || policy !== POLICY.version || !Number.isSafeInteger(now) || now < 0) throw new Error('invalid run identity or unsupported policy');
  const approver = ApproverSchema.parse(frozen?.approver); assertHash(frozen.projectPolicy);
  return { schemaVersion: 2, id, host, repository, policy, policyIdentity: POLICY_IDENTITY, approver, projectPolicy: frozen.projectPolicy, revisions: 0, state: 'requested', createdAt: now, updatedAt: now, events: [], repairs: 0, infrastructureRetries: 0, activeMs: 0 };
}
export function assertRunPolicy(run: Run | HistoricalRun): asserts run is Run {
  if (run.schemaVersion !== 2 || run.policy !== POLICY.version || run.policyIdentity !== POLICY_IDENTITY) throw new Error('run policy differs from installed policy; use its original release or cancel; no implicit migration');
}
