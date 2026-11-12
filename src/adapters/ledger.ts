import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { command, type Options } from './process.js';
import { assertRunPolicy, type HistoricalRun, type Run } from '../domain/workflow.js';
import { ApproverSchema } from '../domain/config.js';

export interface Permit { run: string; host: string; generation: number }
export type StoredRun = Run | HistoricalRun;
export interface Ledger {
  schemaVersion: 2; revision: number; owners: Record<string, Permit>;
  repositories: Record<string, Permit>; builder: Permit | null; runs: Record<string, StoredRun>;
}
export interface ControlMigrationPreview { commit: string; schemaVersion: 1 | 2; revision: number; terminalRuns: number }
export const emptyLedger = (): Ledger => ({ schemaVersion: 2, revision: 0, owners: {}, repositories: {}, builder: null, runs: {} });
export class Conflict extends Error {}

const maxBytes = 4_000_000;
const maxRuns = 1000;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const host = z.string().min(1).max(256).refine(value => !/[\0\r\n]/.test(value));
const repository = z.string().min(3).max(256).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const text = z.string().max(4096);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const state = z.enum(['requested', 'spec-drafted', 'spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair', 'human-merge-review', 'merged', 'archived', 'paused', 'escalated', 'cancelled']);
const terminal = (value: Run['state']) => ['archived', 'cancelled', 'escalated'].includes(value);
// GitHub repository slugs are case-insensitive; retain the Run's display form.
const repositoryKey = (value: string) => value.toLowerCase();
const PermitSchema = z.object({ run: id, host, generation: integer.min(1) }).strict();
const RunFields = {
  id, host, repository, policy: z.string().min(1).max(128), policyIdentity: hash,
  state, createdAt: integer, updatedAt: integer, events: z.array(z.string().min(1).max(256)).max(4096),
  repairs: integer, infrastructureRetries: integer, activeMs: integer,
  spec: hash.optional(), specCommit: commit.optional(), suite: hash.optional(), commit: commit.optional(), mergeCommit: commit.optional(),
  approvalRef: text.optional(), publicationRef: text.optional(), verification: z.enum(['pass', 'fail']).optional(), receipt: hash.optional(), repairReceipt: hash.optional(),
  resumeState: state.optional(), reason: text.optional(),
};
const runHistoryValid = (run: { createdAt: number; updatedAt: number; events: string[] }) => run.updatedAt >= run.createdAt && new Set(run.events).size === run.events.length;
const HistoricalRunSchema = z.object({ schemaVersion: z.literal(1), ...RunFields }).strict().refine(runHistoryValid);
const RunSchema = z.object({ schemaVersion: z.literal(2), ...RunFields, approver: ApproverSchema, projectPolicy: hash, revisions: integer, revisionRef: text.optional(), reviewCommit: commit.optional() }).strict().refine(runHistoryValid);
const RunsSchema = z.record(id, z.union([RunSchema, HistoricalRunSchema])).refine(runs => Object.keys(runs).length <= maxRuns);
const OwnersSchema = z.record(id, PermitSchema).refine(owners => Object.keys(owners).length <= maxRuns);
const LedgerSchema = z.object({
  schemaVersion: z.literal(2), revision: integer, owners: OwnersSchema,
  repositories: z.record(repository, PermitSchema).refine(permits => Object.keys(permits).length <= maxRuns),
  builder: PermitSchema.nullable(), runs: RunsSchema,
}).strict();
const LegacySchema = z.object({ schemaVersion: z.literal(1), revision: integer, owner: PermitSchema.nullable(), runs: z.record(id, HistoricalRunSchema).refine(runs => Object.keys(runs).length <= maxRuns) }).strict();
const same = (left: Permit | null | undefined, right: Permit | null | undefined): boolean => !!left && !!right && left.run === right.run && left.host === right.host && left.generation === right.generation;
const invalid = (): never => { throw new Error('invalid control ledger: shape, bounds or ownership consistency'); };

function parseLedger(value: unknown): Ledger {
  if (typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion === 1) {
    throw new Error('legacy control ledger requires explicit quiescent migration; active runs cannot be migrated or taken over');
  }
  const parsed = LedgerSchema.safeParse(value); if (!parsed.success) return invalid();
  // All optional fields have been runtime-validated; JSON storage omits undefined.
  const ledger = parsed.data as Ledger;
  for (const [key, run] of Object.entries(ledger.runs)) {
    if (key !== run.id) invalid();
    if (run.schemaVersion === 1 && !terminal(run.state)) invalid();
    const owner = ledger.owners[key];
    if (terminal(run.state) ? owner !== undefined : !owner) invalid();
  }
  for (const [key, owner] of Object.entries(ledger.owners)) {
    const run = ledger.runs[key];
    if (!run || owner.run !== key || owner.host !== run.host || owner.generation > ledger.revision || terminal(run.state)) invalid();
  }
  for (const [key, permit] of Object.entries(ledger.repositories)) {
    const run = ledger.runs[permit.run];
    if (!run || repositoryKey(run.repository) !== key || !same(ledger.owners[permit.run], permit)) invalid();
  }
  if (ledger.builder) {
    const run = ledger.runs[ledger.builder.run];
    if (!run || !same(ledger.builder, ledger.owners[run.id]) || !same(ledger.builder, ledger.repositories[repositoryKey(run.repository)])) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(ledger)) + 1 > maxBytes) invalid();
  return ledger;
}
function quiescentMigration(value: unknown): { schemaVersion: 1 | 2; ledger: Ledger } {
  if (typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion === 2) return { schemaVersion: 2, ledger: parseLedger(value) };
  const legacy = LegacySchema.safeParse(value); if (!legacy.success) return invalid();
  if (legacy.data.owner || Object.values(legacy.data.runs).some(run => !terminal(run.state))) throw new Conflict('control migration requires a quiescent legacy ledger: no owner and all runs terminal');
  return { schemaVersion: 1, ledger: { ...emptyLedger(), revision: legacy.data.revision, runs: legacy.data.runs as Record<string, HistoricalRun> } };
}

/** Durable ownership always applies; effectful operations additionally need the repository permit. */
export function assertOwned(ledger: Ledger, runId: string, ownerHost: string, generation: number, requireRepo = true): Run {
  const owner = ledger.owners[runId]; const run = ledger.runs[runId];
  if (!run || !owner || terminal(run.state) || !same(owner, { run: runId, host: ownerHost, generation })) throw new Conflict('stale or foreign run ownership');
  assertRunPolicy(run);
  if (requireRepo && !same(owner, ledger.repositories[repositoryKey(run.repository)])) throw new Conflict('repository execution permit is not held by this run generation');
  return run;
}

export class GitLedger {
  constructor(readonly remote: string, private readonly execute = command) {
    if (!remote || remote.length > 4096 || remote.startsWith('-') || /[\0\r\n]/.test(remote)) throw new Error('invalid control remote');
  }
  private async git(args: readonly string[], options: Options = {}): Promise<string> {
    const result = await this.execute('git', args, options);
    if (result.code !== 0 || result.interrupted) throw new Error(`control Git operation failed: ${result.stderr.slice(0, 2000)}`);
    return result.stdout.trim();
  }
  private async checkout<T>(fn: (dir: string, value: unknown) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'aegean-control-'));
    try {
      await this.git(['-c', 'core.hooksPath=/dev/null', 'clone', '--bare', '--single-branch', '--branch', 'control', '--quiet', '--', this.remote, dir]);
      const size = Number(await this.git(['cat-file', '-s', 'HEAD:control.json'], { cwd: dir }));
      if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) invalid();
      let value: unknown;
      try { value = JSON.parse(await this.git(['show', 'HEAD:control.json'], { cwd: dir, maxBytes })); }
      catch { throw new Error('invalid control ledger: unreadable or malformed JSON'); }
      return await fn(dir, value);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  private async save(dir: string, next: Ledger): Promise<Ledger> {
    const validated = parseLedger(next);
    const blob = await this.git(['hash-object', '-w', '--stdin'], { cwd: dir, input: JSON.stringify(validated) + '\n' });
    const tree = await this.git(['mktree'], { cwd: dir, input: `100644 blob ${blob}\tcontrol.json\n` });
    const parent = await this.git(['rev-parse', 'HEAD'], { cwd: dir });
    const sha = await this.git(['-c', 'user.name=Aegean', '-c', 'user.email=aegean@localhost', 'commit-tree', tree, '-p', parent], { cwd: dir, input: `control revision ${validated.revision} schema ${validated.schemaVersion}\n` });
    const pushed = await this.execute('git', ['-c', 'core.hooksPath=/dev/null', 'push', '--quiet', 'origin', `${sha}:refs/heads/control`], { cwd: dir });
    if (pushed.code !== 0 || pushed.interrupted) {
      // Reconcile this exact commit, including a later legitimate descendant.
      // A mutation is never replayed automatically after an uncertain push.
      const fetched = await this.execute('git', ['fetch', '--quiet', 'origin', 'control'], { cwd: dir });
      const ancestry = fetched.code === 0 && !fetched.interrupted ? await this.execute('git', ['merge-base', '--is-ancestor', sha, 'FETCH_HEAD'], { cwd: dir }) : null;
      if (!ancestry || ancestry.code !== 0 || ancestry.interrupted) throw new Conflict('control update not confirmed; read remote state before retrying (ownership conflict or network failure)');
    }
    return validated;
  }
  async read(): Promise<Ledger> { return this.checkout(async (_dir, value) => parseLedger(value)); }
  async update(change: (state: Ledger) => Ledger): Promise<Ledger> {
    return this.checkout(async (dir, value) => {
      const current = parseLedger(value);
      const next = change(structuredClone(current));
      next.revision = current.revision;
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('control ledger revision exhausted; explicit maintenance required');
      next.revision = current.revision + 1;
      return this.save(dir, next);
    });
  }
  async acquire(run: Run): Promise<Ledger> {
    const parsed = RunSchema.safeParse(run); if (!parsed.success) return invalid();
    const requested = parsed.data as Run;
    assertRunPolicy(requested);
    return this.update(state => {
      if (Object.hasOwn(state.runs, requested.id)) throw new Conflict('run already exists');
      const key = repositoryKey(requested.repository); const occupied = state.repositories[key];
      if (occupied) throw new Conflict(`repository permit active for run ${occupied.run} on ${occupied.host}; no automatic takeover`);
      if (terminal(requested.state)) throw new Error('cannot acquire a terminal run');
      const permit = { run: requested.id, host: requested.host, generation: state.revision + 1 };
      state.owners[requested.id] = permit; state.repositories[key] = permit; state.runs[requested.id] = requested; return state;
    });
  }
  async owned(runId: string, ownerHost: string, generation: number, change: (run: Run) => Run): Promise<Ledger> {
    return this.update(state => {
      const run = assertOwned(state, runId, ownerHost, generation);
      const identity = JSON.stringify([run.id, run.host, run.repository, run.policy, run.policyIdentity, run.createdAt, run.approver.id, run.approver.login, run.projectPolicy]);
      const next = change(run);
      if (identity !== JSON.stringify([next.id, next.host, next.repository, next.policy, next.policyIdentity, next.createdAt, next.approver?.id, next.approver?.login, next.projectPolicy])) throw new Error('owned update cannot change immutable run identity, approver or project policy');
      state.runs[runId] = next;
      if (terminal(next.state)) {
        const owner = state.owners[runId]!;
        if (same(state.repositories[repositoryKey(next.repository)], owner)) delete state.repositories[repositoryKey(next.repository)];
        if (same(state.builder, owner)) state.builder = null;
        delete state.owners[runId];
      }
      return state;
    });
  }
  async resumeOwned(runId: string, ownerHost: string, generation: number, expectedRevision?: number): Promise<Ledger> {
    return this.update(state => {
      if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new Conflict('control revision changed before the recorded permit grant; reconcile its intent before retrying');
      const run = assertOwned(state, runId, ownerHost, generation, false);
      const owner = state.owners[runId]!; const key = repositoryKey(run.repository); const occupied = state.repositories[key];
      if (same(occupied, owner)) return state;
      if (occupied) throw new Conflict(`repository permit active for run ${occupied.run}; no automatic takeover`);
      const next = { run: runId, host: ownerHost, generation: state.revision + 1 };
      state.owners[runId] = next; state.repositories[key] = next; return state;
    });
  }
  async claimBuilder(runId: string, ownerHost: string, generation: number): Promise<Ledger> {
    return this.update(state => {
      assertOwned(state, runId, ownerHost, generation);
      const owner = state.owners[runId]!;
      if (state.builder && !same(state.builder, owner)) throw new Conflict(`Builder permit active for run ${state.builder.run}; no automatic takeover`);
      state.builder = owner; return state;
    });
  }
  async releaseBuilder(runId: string, ownerHost: string, generation: number): Promise<Ledger> {
    return this.update(state => {
      assertOwned(state, runId, ownerHost, generation, false);
      if (same(state.builder, state.owners[runId])) state.builder = null;
      return state;
    });
  }
  /** Caller must confirm every writer stopped before releasing execution permits. */
  async releasePermits(runId: string, ownerHost: string, generation: number): Promise<Ledger> {
    return this.update(state => {
      const run = assertOwned(state, runId, ownerHost, generation, false); const owner = state.owners[runId]!;
      const key = repositoryKey(run.repository);
      if (same(state.repositories[key], owner)) delete state.repositories[key];
      if (same(state.builder, owner)) state.builder = null;
      return state;
    });
  }
  /** Explicit migration only; no live schema-1 owner or nonterminal run is adopted. */
  async inspectMigration(): Promise<ControlMigrationPreview> {
    return this.checkout(async (dir, value) => {
      const source = quiescentMigration(value);
      return { commit: await this.git(['rev-parse', 'HEAD'], { cwd: dir }), schemaVersion: source.schemaVersion, revision: source.ledger.revision, terminalRuns: Object.values(source.ledger.runs).filter(run => terminal(run.state)).length };
    });
  }
  async migrateQuiescent(expectedCommit?: string): Promise<Ledger> {
    if (expectedCommit !== undefined && !/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error('migration requires an exact reviewed control commit');
    return this.checkout(async (dir, value) => {
      if (expectedCommit !== undefined && await this.git(['rev-parse', 'HEAD'], { cwd: dir }) !== expectedCommit) throw new Conflict('control migration source changed after human review; authorization is stale');
      const source = quiescentMigration(value);
      return source.schemaVersion === 2 ? source.ledger : this.save(dir, source.ledger);
    });
  }
}
