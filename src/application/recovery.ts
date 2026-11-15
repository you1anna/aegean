import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson } from '../adapters/files.js';
import { GitLedger, assertOwned } from '../adapters/ledger.js';
import { transition } from '../domain/workflow.js';
import { hostConfig, stateRoot } from './runtime.js';
import { observeRun, finalizeRunEvidence } from './run-evidence.js';
import { loadLocalRun } from './run-record.js';
import { budgetStatus, reconcileCompletedBudget, recoverBudgetLock, settleUnknownBudget } from './usage-budget.js';
import type { RoleRecord } from './role-result.js';
import { reconcileVerifierResource } from './verifier-recovery.js';
import { reconcileBuilder } from './builder.js';
import { acquireRunPermit, reconcilePermitIntent, releaseQuiescentPermits } from './ownership.js';

export async function recover(id: string, confirmedStopped: boolean, root: string): Promise<unknown> {
  if (!/^run-[a-f0-9-]{36}$/.test(id) || !confirmedStopped) throw new Error('recovery requires a valid run and --confirm-stopped after inspecting its child processes');
  const dir = join(stateRoot(), 'runs', id); const marker = join(dir, 'executing');
  const host = await hostConfig(); const ledger = new GitLedger(host.controlRemote);
  const local = await loadLocalRun(dir);
  let created = false;
  try { await mkdir(marker); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  try {
    let owner: { pid: number } | undefined;
    try { owner = await readJson(join(marker, 'owner.json')) as typeof owner; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (!owner && !created) throw new Error('execution owner record missing; lock may still be initializing; do not remove it without a manual process audit');
    if (owner) {
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('invalid execution owner; inspect marker manually');
      let alive = true; try { process.kill(owner.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new Error('owning coordinator is still alive; recovery refused');
    }
    await mkdir(join(marker, 'recovery')).catch(() => { throw new Error('recovery already in progress; inspect its owner'); });
    try {
      await reconcilePermitIntent(ledger, dir, local, host.host);
      const state = await ledger.read(); const run = state.runs[id];
      if (!run) throw new Error('unknown run');
      if (run.host !== host.host) throw new Error('foreign run ownership; recovery refused');
      await recoverBudgetLock(dir);
      if (!['archived','cancelled','escalated'].includes(run.state)) {
        assertOwned(state, id, host.host, local.generation, false);
        await acquireRunPermit(ledger, dir, local, host.host);
        await reconcileVerifierResource(dir);
        await reconcileBuilder(dir, local.worktree);
        let names: string[] = []; try { names = await readdir(join(dir,'effects')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        const pending: RoleRecord[] = [];
        for (const name of names.filter(n => n.endsWith(`-${run.events.length}.json`))) {
          const record = await readJson(join(dir,'effects',name)) as RoleRecord;
          if (record.status === 'running') pending.push(record);
        }
        if (pending.length > 1) throw new Error('multiple unfinished effects; manual audit required');
        await reconcileCompletedBudget(dir);
        const usage = await budgetStatus(dir);
        if (pending[0] || usage.uncertain) {
          const item = pending[0] ?? { startedAt: Date.now(), timeoutMs: 1 };
          if (!Number.isFinite(item.startedAt) || !Number.isSafeInteger(item.timeoutMs) || item.timeoutMs <= 0) throw new Error('invalid effect timing');
          if (run.state !== 'paused') await ledger.owned(id, host.host, local.generation, current => transition(current, { id:randomUUID(), at:Date.now(), type:'pause', reason:'operator confirmed stopped after unknown role outcome; prior evidence retained', activeMs:Math.max(0,Math.min(Date.now()-item.startedAt,item.timeoutMs)) }));
          await settleUnknownBudget(dir);
          await observeRun(root, dir, run as import('../domain/workflow.js').Run, 'recovery', 'interruption', 'pass', { pending: pending.map(item => item.key), unknownCalls: usage.uncertain });
          await finalizeRunEvidence(root, dir, run as import('../domain/workflow.js').Run, ['recovery']);
        }
      }
      else { await reconcileVerifierResource(dir); await reconcileBuilder(dir, local.worktree); }
      await releaseQuiescentPermits(ledger, dir, local, host.host);
      await rm(marker, { recursive: true });
      return { id, recovered:true, action:'Inspect status, then resume explicitly; no model or takeover was performed' };
    } catch (e) { await rm(join(marker,'recovery'),{recursive:true,force:true}); throw e; }
  } catch (e) { if (created) await rm(marker,{recursive:true,force:true}); throw e; }
}
