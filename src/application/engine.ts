import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { transition } from '../domain/workflow.js';
import { nextSteps, listSteps } from '../domain/next-steps.js';
import { GitLedger } from '../adapters/ledger.js';
import { hostConfig, stateRoot, binaries, requireSubscriptions } from './runtime.js';
import { prepareRun } from './prepare.js';
import { reserveHost } from '../adapters/host-activity.js';
import { budgetStatus } from './usage-budget.js';
import { observeRun } from './run-evidence.js';
import { savedPilot } from './pilot.js';
import { executionLock } from '../adapters/run-lock.js';
import { reconcileVerifierResource } from './verifier-recovery.js';
import { reconcileBuilder } from './builder.js';
import { acquireRunPermit, releaseQuiescentPermits } from './ownership.js';
import { baselineText } from './build-checks.js';
import { loadLocalRun, suiteRelativePath, specificationFolder, localReview } from './run-record.js';
import { validateLocalSpecApproval } from './decisions.js';
import { RunSession, nowEvent } from './run-session.js';
import { NEXT, STOP, draftSpecification, reviewSpecification, stageTests, checkBaseline, build, verifyCandidate, reviewCandidate, publishCandidate, archiveRun, type Drafted } from './run-stages.js';
export async function start(root: string, repo: string, request: string, signal: AbortSignal): Promise<unknown> {
  await requireSubscriptions(root);
  const prepared = await prepareRun(repo, request, signal);
  return resume(root, prepared.id, signal);
}
export async function status(id?: string): Promise<unknown> {
  if (id && !/^run-[a-f0-9-]{36}$/.test(id)) throw new Error('invalid run identifier');
  const host = await hostConfig(); const state = await new GitLedger(host.controlRemote).read();
  let usage: unknown;
  if (!id) { const runs = Object.values(state.runs); return { owners: state.owners, repositories: state.repositories, builder: state.builder, runs: runs.map(r => ({ id: r.id, host: r.host, state: r.state, repairs: r.repairs, activeMs: r.activeMs })), next: listSteps(runs.map(r => r.state)) }; }
  const run = state.runs[id];
  if (!run) return { error: 'unknown run', next: ['List the runs: aegean status', 'A run exists only after you run this in the project repository: aegean prepare --request FILE'] };
  const dir = join(stateRoot(), 'runs', id);
  try { usage = await budgetStatus(dir); }
  catch (error) { usage = { available: false, reason: (error as Error).message }; }
  // Guidance reads local facts only; a run owned by another host has none here.
  const pilot = await savedPilot(dir).then(saved => saved && { expiresAt: saved.artifact.expiresAt, budget: saved.artifact.budget }, () => undefined);
  const local = run.spec ? await loadLocalRun(dir).catch(() => undefined) : undefined;
  const specification = local && specificationFolder(local) + '/';
  // Before approval the notes can still change; after approval they are history.
  const review = local && run.state === 'spec-drafted' ? await localReview(local) : undefined;
  const baseline = run.schemaVersion === 2 ? await baselineText(dir, run.suite).catch(() => undefined) : undefined;
  return { ...run, usage, ...(pilot ? { pilot: { expiresAt: new Date(pilot.expiresAt).toISOString(), budget: pilot.budget } } : {}), ...(specification ? { specification } : {}), ...(review ? { review } : {}), ...(baseline ? { baseline } : {}), next: nextSteps(run, { ...(pilot ? { pilotExpiresAt: pilot.expiresAt } : {}), ...(specification ? { specification } : {}), runFolder: dir }) };
}
export async function cancel(id: string, root: string): Promise<unknown> {
  if (!/^run-[a-f0-9-]{36}$/.test(id)) throw new Error('invalid run identifier');
  const host = await hostConfig(); const ledger = new GitLedger(host.controlRemote);
  const dir = join(stateRoot(), 'runs', id); const local = await loadLocalRun(dir);
  const release = await executionLock(dir);
  try {
    const state = await ledger.read();
    if (state.runs[id]?.host !== host.host) throw new Error('foreign run ownership; cancellation refused');
    if (!local.generation && state.owners[id]?.host === host.host) local.generation = state.owners[id]!.generation;
    if (state.runs[id]?.state !== 'cancelled') await acquireRunPermit(ledger, dir, local, host.host);
    await reconcileVerifierResource(dir);
    await reconcileBuilder(dir, local.worktree);
    if (state.runs[id]?.state === 'cancelled') return state;
    const cancelledRun = state.runs[id]!;
    const cancelled = await ledger.cancelOwned(id, host.host, local.generation, run => transition(run, nowEvent('cancel')));
    try {
      if (cancelledRun.schemaVersion === 2) await observeRun(root, dir, cancelledRun, 'recovery', 'cancellation', 'pass', { resourcesStopped: true, generation: local.generation });
    } catch (error) { return { ...cancelled, evidenceWarning: `Cancellation completed; observation unavailable: ${(error as Error).message}` }; }
    return cancelled;
  } finally { try { await releaseQuiescentPermits(ledger, dir, local, host.host); } finally { await release(); } }

}
export async function resume(root: string, id: string, signal: AbortSignal): Promise<unknown> {
  const releaseHost = await reserveHost(stateRoot(), 'execution', `resume ${id}`);
  try { return await resumeRun(root, id, signal); } finally { await releaseHost(); }
}
async function resumeRun(root: string, id: string, signal: AbortSignal): Promise<unknown> {
  if (!/^run-[a-f0-9-]{36}$/.test(id)) throw new Error('invalid run identifier');
  const host = await hostConfig(); const bins = binaries(root); const ledger = new GitLedger(host.controlRemote);
  const dir = join(stateRoot(), 'runs', id); const local = await loadLocalRun(dir);
  const release = await executionLock(dir);
  const session = new RunSession(root, id, signal, host, bins, ledger, dir, local);
  try {
    const stopped = await session.open();
    if (stopped) return stopped;
    return await advance(session);
  } catch (error) {
    await session.pauseOnContextFault(error);
    throw error;
  } finally {
    try { await releaseQuiescentPermits(ledger, dir, local, host.host); } finally { await release(); }
  }
}
const BUILD_LOOP: readonly string[] = ['tests-staged', 'repair', 'building', 'verifying', 'reviewing'];
/** Take the run through each stage that its state allows. A stage can end the resume early. */
async function advance(session: RunSession): Promise<unknown> {
  const { root, dir, local, host, signal } = session;
  if (session.run.state === 'paused') await session.update(nowEvent('resume'));
  let drafted: Drafted | undefined;
  if (session.run.state === 'requested') {
    const outcome = await draftSpecification(session);
    if ('result' in outcome) return outcome.result;
    drafted = outcome.drafted;
  }
  if (session.run.state === 'spec-drafted') {
    const outcome = await reviewSpecification(session, drafted);
    if (outcome !== NEXT) return outcome.result;
  }
  if (session.project.approvalMode === 'local' && !['merged', 'archived'].includes(session.run.state)) await validateLocalSpecApproval(root, dir, local, session.run);
  if (session.run.approvalRef) await observeRun(root, dir, session.run, 'lifecycle', 'exact-spec-approval', 'pass', session.run.approvalRef);
  if (['spec-approved', 'tests-staged', 'repair', 'building', 'reviewing'].includes(session.run.state)) await requireSubscriptions(root);
  const suitePath = join(host.verifierCheckout, suiteRelativePath(session.run));
  if (session.run.state === 'spec-approved') {
    const outcome = await stageTests(session, suitePath);
    if (outcome !== NEXT) return outcome.result;
  }
  while (BUILD_LOOP.includes(session.run.state)) {
    if (signal.aborted) throw new Error('cancelled by operator');
    await session.assertOwned(); await session.authorization();
    if (session.run.state === 'tests-staged') { if (await checkBaseline(session, suitePath) === STOP) break; }
    else if (session.run.state === 'repair') await session.update(nowEvent('begin-build'));
    if (session.run.state === 'building' && await build(session) === STOP) break;
    if (session.run.state === 'verifying' && await verifyCandidate(session, suitePath) === STOP) break;
    if (session.run.state === 'reviewing' && await reviewCandidate(session) === STOP) break;
  }
  if (session.run.state === 'human-merge-review') {
    const outcome = await publishCandidate(session);
    if (outcome !== NEXT) return outcome.result;
  }
  if (session.run.state === 'merged') await archiveRun(session);
  return { run: session.run, pr: local.pr, action: session.run.state === 'human-merge-review' ? 'Review trusted local evidence and merge the PR manually' : 'Inspect status before continuing' };
}
export async function localRuns(): Promise<string[]> { try { return await readdir(join(stateRoot(), 'runs')); } catch { return []; } }
