import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidateGit, candidateGitChecked } from '../adapters/candidate-git.js';
import { transition } from '../domain/workflow.js';
import { digest, identity } from '../domain/digest.js';
import { POLICY } from '../domain/workflow-policy.js';
import { TERMINAL_STATES, assertRunPolicy, isTerminal, type Event, type Run } from '../domain/run.js';
import { selectModel, type ModelRole, type ModelProfile } from '../domain/model-policy.js';
import { assertSupportedImage, type Project } from '../domain/config.js';
import { responseFault } from '../domain/scout.js';
import { promptRecord } from '../domain/context.js';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { type GitLedger, assertOwned as assertLedgerOwned } from '../adapters/ledger.js';
import type { Result } from '../adapters/process.js';
import { atomicJson, treeDigest } from '../adapters/files.js';
import { operatorStage } from '../adapters/operator-log.js';
import { assertRemoteIdentity } from '../adapters/git-effects.js';
import { doctor, type HostConfig, type binaries } from './runtime.js';
import { budgetedRole, reconcileCompletedBudget } from './usage-budget.js';
import { observeRun } from './run-evidence.js';
import { executionAuthorization } from './pilot.js';
import { reconcileVerifierResource } from './verifier-recovery.js';
import { reconcileBuilder } from './builder.js';
import { acquireRunPermit } from './ownership.js';
import { specificationFolder, type LocalRun } from './run-record.js';
import { frozenProject } from './decisions.js';

export const nowEvent = (type: Event['type'], fields: Record<string, unknown> = {}): Event => ({ id: randomUUID(), at: Date.now(), type, ...fields } as Event);
/** Keep the first record of a context: a replayed call must not replace the evidence of the original call. */
export async function recordContext(path: string, value: unknown): Promise<void> {
  try { await readBoundedEvidenceFile(path, 2_000_000); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await atomicJson(path, value); }
}
type Observation = readonly [Parameters<typeof observeRun>[3], string];
/** The evidence check that each model role's call records. */
const ROLE_OBSERVATION: { readonly [R in ModelRole]: Observation } = {
  scout: ['lifecycle', 'scout'],
  builder: ['live-loop', 'sandboxed-builder'],
  'auditor-tests': ['live-loop', 'independent-auditor'],
  'auditor-review': ['live-loop', 'independent-review'],
};
const OUTSIDE_EXECUTION: readonly string[] = ['human-merge-review', 'merged', 'archived'];

/**
 * One resume of one run on this host. It owns the ledger record of the run and the effects that every stage shares.
 * `run` is always the latest record: read it again after each `update`, and never keep a copy across one.
 */
export class RunSession {
  #run: Run | undefined;
  /** Set by `open`. */
  project!: Project;
  /** The frozen `aegean.json` text, set by `open`. */
  originalProject!: string;
  ordinaryReady = false;
  readonly specDir: string;
  constructor(
    readonly root: string, readonly id: string, readonly signal: AbortSignal,
    readonly host: HostConfig, readonly bins: ReturnType<typeof binaries>, readonly ledger: GitLedger,
    readonly dir: string, readonly local: LocalRun,
  ) { this.specDir = specificationFolder(local); }

  get run(): Run { return this.#run!; }

  /** Load the run, take ownership and check its frozen inputs. Returns a result when the resume must stop here. */
  async open(): Promise<unknown> {
    const { ledger, local, id, host, dir } = this;
    const state = await ledger.read(); const stored = state.runs[id];
    if (stored && isTerminal(stored.state)) return { run: stored };
    if (stored) assertRunPolicy(stored);
    this.#run = stored;
    if (!local.generation && state.owners[id]?.host === host.host) {
      local.generation = state.owners[id]!.generation; await atomicJson(join(dir, 'run.json'), local);
    }
    if (!this.#run) throw new Error('unknown run');
    await acquireRunPermit(ledger, dir, local, host.host);
    await reconcileVerifierResource(dir);
    await reconcileBuilder(dir, local.worktree);
    await reconcileCompletedBudget(dir);
    try { await access(local.worktree); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || this.run.state !== 'requested') throw e;
      const branch = await candidateGit(['show-ref', '--verify', '--quiet', `refs/heads/${local.branch}`], { cwd: local.repo });
      if (branch.code === 0 && await candidateGitChecked(['rev-parse', local.branch], { cwd: local.repo }) !== local.base) throw new Error('interrupted worktree branch differs from frozen base');
      await candidateGitChecked(['worktree', 'add', ...(branch.code === 0 ? [] : ['-b', local.branch]), local.worktree, branch.code === 0 ? local.branch : local.base], { cwd: local.repo });
    }
    const original = await candidateGit(['show', `${local.base}:aegean.json`], { cwd: local.repo });
    if (original.code !== 0) throw new Error('cannot read frozen project configuration');
    this.originalProject = original.stdout;
    if (digest(this.originalProject) !== this.run.projectPolicy) throw new Error('frozen project policy differs from run identity');
    if (await readFile(join(local.worktree, 'aegean.json'), 'utf8') !== this.originalProject) throw new Error('project configuration changed after run creation');
    this.project = await frozenProject(local, this.run);
    assertSupportedImage(this.project);
    if (this.run.spec && !['spec-drafted', 'merged', 'archived'].includes(this.run.state) && await treeDigest(this.specDir) !== this.run.spec) throw new Error('approved specification changed; restore it or cancel and request a new approval');
    const readiness = await doctor(this.root); this.ordinaryReady = readiness.fullWorkflowReady;
    if (!OUTSIDE_EXECUTION.includes(this.run.state)) {
      if (!readiness.prerequisitesReady) return { run: this.run, blocked: 'Native containment, verifier and subscription prerequisites must pass before execution; run aegean doctor --json' };
      await this.authorization();
    }
    return undefined;
  }

  authorization() { return executionAuthorization(this.root, this.dir, this.local, this.run, this.ordinaryReady); }

  /** Apply one event to the owned ledger record. */
  async update(event: Event): Promise<Run> {
    const state = await this.ledger.owned(this.id, this.host.host, this.local.generation, current => transition(current, event));
    const updated = state.runs[this.id]!; assertRunPolicy(updated); this.#run = updated; return this.run;
  }

  /** Call directly before each external effect: the run, its remote and, during execution, its base must be unchanged. */
  async assertOwned(): Promise<void> {
    const { signal, local } = this;
    if (signal.aborted) throw new Error('interrupted before external effect');
    const current = await this.ledger.read();
    if (signal.aborted) throw new Error('interrupted before external effect');
    assertLedgerOwned(current, this.id, this.host.host, local.generation);
    await assertRemoteIdentity(local.worktree, this.run.repository, signal);
    if (!OUTSIDE_EXECUTION.includes(this.run.state) && (await candidateGitChecked(['ls-remote', 'origin', 'refs/heads/main'], { cwd: local.worktree, signal })).split(/\s/)[0] !== local.base) throw new Error('remote base changed before execution');
  }

  /**
   * Make one budgeted model call. A failure before the call pauses the run and throws.
   * An unusable answer pauses the run and gives undefined.
   */
  async model<T>(role: ModelRole, prompt: string, timeoutMs: number, invoke: (timeout: number, deadline: AbortSignal, profile: ModelProfile) => Promise<Result>, parse: (result: Result) => T): Promise<{ value: T; durationMs: number } | undefined> {
    const { root, dir, local } = this;
    operatorStage(this.id, role);
    await this.assertOwned();
    const limits = await this.authorization();
    const timeout = Math.min(timeoutMs, limits.remainingMs);
    const deadline = AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]);
    let result: Result;
    try {
      if (!this.project.modelExecution) throw new Error('explicit modelExecution policy required');
      const rolePolicy = POLICY.models.roles[role];
      if (Buffer.byteLength(prompt) > rolePolicy.inputBytes) throw new Error(`required ${role} context exceeds ${rolePolicy.inputBytes} bytes`);
      const profile = selectModel(POLICY.models, role, this.project.modelExecution.task, this.run.repairs, toolchain);
      const key = `${role}-${this.run.repairs}-${this.run.events.length}`;
      await recordContext(join(dir, 'contexts', `${key}.json`), promptRecord(role, prompt));
      result = await budgetedRole(dir, key, timeout, limits.budget.maxModelCalls, () => invoke(timeout, deadline, profile), {
        role, profile, budgetIdentity: identity(this.project.modelExecution.budget), cliVersion: toolchain[profile.provider], contextDigest: digest(prompt), generation: local.generation,
        requireReportedModel: identity(profile) !== identity(rolePolicy.baseline), assertOwned: () => this.assertOwned(),
      });
    } catch (error) {
      await this.update(nowEvent('pause', { reason: `${role}: ${(error as Error).message}`, activeMs: 0 }));
      throw error;
    }
    const [kind, check] = ROLE_OBSERVATION[role];
    let value: T;
    try {
      if (result.code !== 0 || result.interrupted) throw new Error('interrupted, quota or tool failure');
      value = parse(result);
    } catch (error) {
      const fault = result.code !== 0 || result.interrupted ? 'interrupted or unavailable' : `invalid response (${responseFault(error)})`;
      await observeRun(root, dir, this.run, kind, check, 'unknown', { role, code: result.code, interrupted: result.interrupted });
      await this.update(nowEvent('pause', { reason: `${role}: ${fault}; inspect private effect receipt before explicit resume`, activeMs: result.durationMs }));
      return undefined;
    }
    if (limits.pilot) await observeRun(root, dir, this.run, 'real-pilot', 'compatible-project', 'pass', limits.pilot);
    await observeRun(root, dir, this.run, kind, check, 'pass', { role, key: this.run.events.length, code: result.code });
    await observeRun(root, dir, this.run, 'live-loop', 'subscription-only', 'pass', { role, code: result.code });
    return { value, durationMs: result.durationMs };
  }

  /** A context or bounded-evidence fault pauses an active run, so that the operator can fix the input and resume. */
  async pauseOnContextFault(error: unknown): Promise<void> {
    const run = this.#run;
    if (run && !['paused', 'merged', ...TERMINAL_STATES].includes(run.state) && /context|bounded evidence|file size/i.test((error as Error).message)) await this.update(nowEvent('pause', { reason: (error as Error).message, activeMs: 0 }));
  }
}
