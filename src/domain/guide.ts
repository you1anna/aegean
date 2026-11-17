import { POLICY, type State } from './workflow.js';
import { REVIEW_NOTES } from './scout.js';
import { ALLOWED_PATHS } from './allowed-paths.js';

/** Terminal port of the interactive guide. An adapter draws it; tests script it. */
export interface Choice<T extends string> { value: T; label: string; hint?: string }
export interface TextOptions { initial?: string; paths?: boolean; validate?: (value: string) => string | undefined }
export interface GuideUi {
  banner(title: string, lines: string[]): void;
  step(title: string): void;
  say(text: string): void;
  note(text: string): void;
  good(text: string): void;
  warn(text: string): void;
  bad(text: string): void;
  /** The cursor starts on the choice with the initial value, or on the first choice. */
  select<T extends string>(question: string, choices: Choice<T>[], initial?: T): Promise<T>;
  text(question: string, options?: TextOptions): Promise<string>;
  task<T>(label: string, work: () => Promise<T>): Promise<T>;
  /** Shows a long text. It returns only after the operator closes the text. */
  page(title: string, text: string): Promise<void>;
}
/** The operator left the guide. A run keeps its recorded state. */
export class GuideStop extends Error { constructor(readonly interrupted = false) { super('guide stopped'); } }

export const ENDED: readonly string[] = ['archived', 'cancelled', 'escalated'];
export const SPEC_FILES = [REVIEW_NOTES, 'proposal.md', 'specs/contract/spec.md', ALLOWED_PATHS, 'design.md', 'tasks.md'] as const;
export const REQUEST_TEMPLATE = '# Goal\n\n\n# Limits\n\n\n# Tests of success\n\n';

/** Start values for the limits questions. The policy owns each maximum; the operator reviews each value. */
export const LIMIT_FIELDS = [
  { key: 'expiresInMinutes', question: 'Minutes until the authorisation expires; include your review time (1 to 1440)', initial: 120 },
  { key: 'maxModelCalls', question: `Model calls (1 to ${POLICY.maxModelCalls})`, initial: POLICY.maxModelCalls },
  { key: 'activeMinutes', question: `Active minutes (1 to ${POLICY.activeTimeoutMs / 60_000})`, initial: POLICY.activeTimeoutMs / 60_000 },
  { key: 'maxRepairs', question: `Code repairs (0 to ${POLICY.maxRepairs})`, initial: POLICY.maxRepairs },
  { key: 'maxRevisions', question: `Human revisions (0 to ${POLICY.maxRevisions})`, initial: POLICY.maxRevisions },
] as const;

/**
 * The meaning of one host check result. A release that is not accepted is information, not a host fault:
 * a pilot authorisation covers one run without it.
 */
export function checkLevel(check: { name: string; ok: boolean }): 'pass' | 'fail' | 'info' {
  return check.ok ? 'pass' : check.name === 'release-acceptance' ? 'info' : 'fail';
}

/** A failed host check that one installed command can correct. Other checks need the operations guide. */
export function checkFix(name: string): { label: string; command: string[]; terminal: boolean } | undefined {
  if (name === 'claude-subscription') return { label: 'Log in to Claude', command: ['auth', 'login', 'claude'], terminal: true };
  if (name === 'codex-subscription') return { label: 'Log in to Codex', command: ['auth', 'login', 'codex'], terminal: true };
  if (name === 'verifier-vm') return { label: 'Start the verifier', command: ['verifier', 'start'], terminal: false };
  return undefined;
}

export type RunAction = 'authorise' | 'draft' | 'read' | 'edit' | 'record' | 'approve' | 'continue' | 'cancel' | 'stop';
export interface RunFacts { pilot: boolean; pilotExpired: boolean; acceptedRelease: boolean; specification: boolean; /** The open questions and uncovered needs of the draft, in a few words. */ flags?: string }

/**
 * The choices that the guide offers for a run state, most likely first.
 * Guidance only: each choice runs an existing command, and that command keeps its gate.
 * States after specification approval have no menu here; the guide prints nextSteps for them.
 */
export function runChoices(state: State, facts: RunFacts): Choice<RunAction>[] {
  const stop: Choice<RunAction> = { value: 'stop', label: 'Stop here', hint: 'the run keeps its state' };
  const cancel: Choice<RunAction> = { value: 'cancel', label: 'Cancel this run', hint: 'aegean cancel' };
  if (ENDED.includes(state)) return [];
  if (facts.pilotExpired) return [cancel, stop];
  switch (state) {
    case 'requested': return facts.pilot || facts.acceptedRelease
      ? [{ value: 'draft', label: 'Draft the specification', hint: 'one model call; aegean resume' }, stop, cancel]
      : [{ value: 'authorise', label: 'Authorise a pilot for this run', hint: 'no model call; aegean authorize-pilot' }, stop, cancel];
    case 'spec-drafted': return [
      ...(facts.specification ? [
        { value: 'read', label: 'Read a specification file here', hint: `start with ${REVIEW_NOTES}` } as const,
        { value: 'edit', label: 'Open the specification folder in my editor' } as const,
      ] : []),
      { value: 'record', label: 'Record my edits to the specification', hint: 'aegean resume' },
      { value: 'approve', label: 'Approve this specification', hint: `${facts.flags ? `${facts.flags}; ` : ''}you type the confirmation; aegean approve` },
      stop, cancel,
    ];
    case 'paused': return [{ value: 'continue', label: 'The cause is corrected: continue the run', hint: 'aegean resume' }, stop, cancel];
    case 'spec-approved': case 'tests-staged': case 'building': case 'verifying': case 'reviewing': case 'repair':
      return [stop, { value: 'continue', label: 'Continue to the tests and the build', hint: 'model calls; aegean resume' }, cancel];
    default: return [];
  }
}
