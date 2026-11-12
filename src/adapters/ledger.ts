import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checked, command } from './process.js';
import type { Run } from '../domain/workflow.js';

export interface Ledger { schemaVersion: 1; revision: number; owner: { run: string; host: string; generation: number } | null; runs: Record<string, Run> }
export const emptyLedger = (): Ledger => ({ schemaVersion: 1, revision: 0, owner: null, runs: {} });
export class Conflict extends Error {}
export class GitLedger {
  constructor(readonly remote: string) {
    if (remote.startsWith('-') || /[\r\n]/.test(remote)) throw new Error('invalid control remote');
  }
  private async checkout<T>(fn: (dir: string, state: Ledger) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'aegean-control-'));
    try {
      await checked('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--bare', '--single-branch', '--branch', 'control', '--quiet', '--', this.remote, dir]);
      const state = JSON.parse(await checked('git', ['show', 'HEAD:control.json'], { cwd: dir })) as Ledger;
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !state.runs) throw new Error('invalid control ledger');
      return await fn(dir, state);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  async read(): Promise<Ledger> { return this.checkout(async (_dir, state) => state); }
  async update(change: (state: Ledger) => Ledger): Promise<Ledger> {
    return this.checkout(async (dir, state) => {
      const next = change(structuredClone(state)); next.revision = state.revision + 1;
      const blob = await checked('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: JSON.stringify(next) + '\n' });
      const tree = await checked('git', ['mktree'], { cwd: dir, input: `100644 blob ${blob}\tcontrol.json\n` });
      const parent = await checked('git', ['rev-parse', 'HEAD'], { cwd: dir });
      const sha = await checked('git', ['-c', 'user.name=Aegean', '-c', 'user.email=aegean@localhost', 'commit-tree', tree, '-p', parent], { cwd: dir, input: `control revision ${next.revision}\n` });
      const pushed = await command('git', ['-c', 'core.hooksPath=/dev/null', 'push', '--quiet', 'origin', `${sha}:refs/heads/control`], { cwd: dir });
      if (pushed.code !== 0) throw new Conflict('control update not confirmed; read remote state before retrying (ownership conflict or network failure)');
      return next;
    });
  }
  async acquire(run: Run): Promise<Ledger> {
    return this.update(state => {
      if (state.owner) throw new Conflict(`active run ${state.owner.run} on ${state.owner.host}; no automatic takeover`);
      if (state.runs[run.id]) throw new Conflict('run already exists');
      state.owner = { run: run.id, host: run.host, generation: state.revision + 1 }; state.runs[run.id] = run; return state;
    });
  }
  async owned(runId: string, host: string, generation: number, update: (run: Run) => Run): Promise<Ledger> {
    return this.update(state => {
      if (state.owner?.run !== runId || state.owner.host !== host || state.owner.generation !== generation) throw new Conflict('stale or foreign run ownership');
      const run = state.runs[runId]; if (!run) throw new Error('missing run');
      state.runs[runId] = update(run);
      if (['archived', 'cancelled', 'escalated'].includes(state.runs[runId].state)) state.owner = null;
      return state;
    });
  }
}
