import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidateGitChecked } from '../adapters/candidate-git.js';
import { assertRemoteIdentity } from '../adapters/git-effects.js';
import { GitLedger, assertOwned } from '../adapters/ledger.js';
import { executionLock } from '../adapters/run-lock.js';
import { confirmHumanDecision, assertDecision } from '../adapters/human-decision.js';
import { authenticatedApprover, github } from '../adapters/github.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { digest, transition, type Event, type Run } from '../domain/workflow.js';
import type { ExecutionBudget } from '../domain/budgets.js';
import { hostConfig, stateRoot, doctor } from './runtime.js';
import { loadLocalRun, type LocalRun } from './run-record.js';
import { acquireRunPermit, quiescentResources, releaseQuiescentPermits } from './ownership.js';
import { buildSpecArtifact, buildPublicationArtifact, buildRevisionArtifact, persistLocalDecision, frozenProject, validateLocalPublication, type LocalDecisionArtifact } from './decisions.js';
import { pilotArtifact, persistPilot, executionAuthorization, savedPilot, repeatedPilot, type PilotArtifact } from './pilot.js';

type Action = 'approve' | 'publish' | 'revise' | 'pilot';
export interface DecisionOptions { scope?: 'implementation' | 'contract'; expiresAt?: number; budget?: ExecutionBudget; limitsDigest?: string }
type Artifact = LocalDecisionArtifact | PilotArtifact;

/** Remote reads do not trust the candidate's origin or a PR number alone. */
async function remoteIdentity(local: LocalRun, run: Run, action: Action, signal: AbortSignal) {
  const cwd = action === 'pilot' && run.state === 'requested' ? local.repo : local.worktree;
  await assertRemoteIdentity(cwd, run.repository, signal);
  const base = (await candidateGitChecked(['ls-remote', 'origin', 'refs/heads/main'], { cwd, signal })).split(/\s/)[0];
  if (base !== local.base) throw new Error('remote base changed; preserve candidate and start a new reviewed run');
  const head = (await candidateGitChecked(['ls-remote', 'origin', `refs/heads/${local.branch}`], { cwd, signal })).split(/\s/)[0];
  const candidate = action === 'revise' ? await candidateGitChecked(['rev-parse', 'HEAD'], { cwd, signal }) : undefined;
  if (head && ![local.publishedCommit, run.specCommit, run.commit, candidate].includes(head)) throw new Error('remote head changed; reconcile the exact edited candidate before review');
  if (local.pr) {
    const pr = await github(`repos/${run.repository}/pulls/${local.pr}`, signal) as { merged: boolean; state?: string; head: { sha: string; ref: string; repo: { full_name: string } }; base: { ref: string; repo: { full_name: string } } };
    if (pr.merged || pr.state === 'closed') throw new Error('PR already merged or closed; decision refused');
    if (pr.head.ref !== local.branch || pr.head.sha !== head || pr.head.repo.full_name !== run.repository || pr.base.ref !== 'main' || pr.base.repo.full_name !== run.repository) throw new Error('PR identity or head changed');
  }
}

async function withRun<T>(id: string, body: (dir: string, local: LocalRun, run: Run, ledger: GitLedger, host: string) => Promise<T>): Promise<T> {
  if (!/^run-[a-f0-9-]{36}$/.test(id)) throw new Error('invalid run identifier');
  const host = await hostConfig(); const ledger = new GitLedger(host.controlRemote);
  const dir = join(stateRoot(), 'runs', id); const release = await executionLock(dir);
  let local: LocalRun | undefined;
  try {
    local = await loadLocalRun(dir);
    const run = assertOwned(await ledger.read(), id, host.host, local.generation, false);
    if (!await quiescentResources(dir)) throw new Error('unresolved resources; recover before a human decision');
    await acquireRunPermit(ledger, dir, local, host.host);
    return await body(dir, local, run, ledger, host.host);
  } finally { try { if (local) await releaseQuiescentPermits(ledger, dir, local, host.host); } finally { await release(); } }
}

/** Fixed production edges; injection exists only for deterministic synthetic tests. */
export function decisionCoordinator(confirm = confirmHumanDecision) {
  return async (root: string, id: string, action: Action, options: DecisionOptions, signal: AbortSignal) => {
    const build = async (dir: string, local: LocalRun, run: Run): Promise<Artifact> => {
      signal.throwIfAborted();
      const project = await frozenProject(local, run, { allowMissingWorktree: action === 'pilot' });
      if (action !== 'pilot' && project.approvalMode !== 'local') throw new Error('local decisions require explicit local approval policy; comment compatibility cannot silently change');
      await remoteIdentity(local, run, action, signal);
      if (action === 'pilot') {
        if (!options.budget || !options.expiresAt || options.expiresAt <= Date.now() || options.expiresAt > Date.now() + 86_400_000) throw new Error('pilot requires explicit budgets and future expiry within 24 hours');
        if (!(await doctor(root)).prerequisitesReady) throw new Error('pilot requires passing native and subscription prerequisites');
        return pilotArtifact(root, dir, local, run, options.expiresAt, options.budget, options.limitsDigest);
      }
      if (action === 'approve') {
        if (run.state !== 'spec-drafted') throw new Error('specification approval requires spec-drafted state');
        if (await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: local.worktree }) !== run.specCommit || await candidateGitChecked(['status', '--porcelain'], { cwd: local.worktree })) throw new Error('specification head changed; resume to freeze the revised specification');
        return buildSpecArtifact(root, dir, local, run);
      }
      if (action === 'publish') {
        if (run.state !== 'human-merge-review') throw new Error('publication requires human-merge-review state');
        return buildPublicationArtifact(root, dir, local, run);
      }
      if (!options.scope) throw new Error('revision requires explicit implementation or contract scope');
      const limits = await executionAuthorization(root, dir, local, run, (await doctor(root)).fullWorkflowReady);
      if (run.revisions >= limits.budget.maxRevisions) throw new Error('revision budget exhausted');
      return buildRevisionArtifact(root, dir, local, run, options.scope);
    };
    const reviewed = await withRun(id, async (dir, local, run) => {
      // Check a saved authorisation before the human is asked to type a confirmation.
      const saved = action === 'pilot' ? await savedPilot(dir) : undefined;
      if (saved) return { run, repeated: repeatedPilot(saved.artifact, run.id, options) };
      const artifact = await build(dir, local, run);
      if (action === 'publish' && run.publicationRef) {
        await validateLocalPublication(root, dir, local, run);
        return { artifact, run, summary: '', authorized: true };
      }
      const request = (await readBoundedEvidenceFile(local.sourceRequest, 60_000)).toString('utf8');
      const patch = action === 'pilot' ? '' : await candidateGitChecked(['diff', local.base, action === 'revise' ? 'HEAD' : action === 'approve' ? run.specCommit! : run.commit!], { cwd: local.worktree, maxBytes: 200_000, signal });
      const tokenPolicy = action === 'pilot' ? (await frozenProject(local,run,{allowMissingWorktree:true})).modelExecution?.budget : undefined;
      const summary = `${tokenPolicy ? 'Project token allowances (monitored): '+JSON.stringify(tokenPolicy)+'\n' : ''}${action.toUpperCase()}\nRequest:\n${request}\n\nExact artifact:\n${JSON.stringify(artifact, null, 2)}\n\nChanges:\n${patch}\n${action === 'publish' ? 'Publication can trigger repository CI and deployment integrations. This authorizes this exact push, never merge.' : 'This decision does not authorize candidate publication, merge or readiness.'}`;
      if (Buffer.byteLength(summary) > 300_000) throw new Error('decision review exceeds bounded capacity');
      return { artifact, run, summary, authorized: false };
    });
    if ('repeated' in reviewed) return { run: reviewed.run, ...reviewed.repeated, authorized: true, action: `already authorised; no new decision was recorded. Continue with aegean resume --run ${id}` };
    if (reviewed.authorized) return { run: reviewed.run, authorized: true, action: 'resume exact publication' };
    // Neither a Git transaction, execution permit nor local lock spans human waiting.
    const decision = await confirm(action, id, reviewed.summary, reviewed.artifact, reviewed.run.approver, () => authenticatedApprover(reviewed.run.approver, signal), signal);
    assertDecision(decision, action, id, reviewed.artifact, reviewed.run.approver);
    return withRun(id, async (dir, local, run, ledger, host) => {
      const artifact = await build(dir, local, run);
      if (digest(JSON.stringify(artifact)) !== digest(JSON.stringify(reviewed.artifact)) || digest(JSON.stringify(run)) !== digest(JSON.stringify(reviewed.run))) throw new Error('run or decision artifacts changed during human review');
      await authenticatedApprover(run.approver, signal); signal.throwIfAborted();
      if (artifact.kind === 'pilot') { await persistPilot(dir, run, artifact, decision); return { run, authorized: true, action: 'resume explicitly; publication and readiness remain separate' }; }
      const reference = await persistLocalDecision(dir, decision, artifact, reviewed.summary);
      const fields = artifact.kind === 'spec-approval' ? { type: 'approve', spec: artifact.spec, specCommit: artifact.specCommit } : artifact.kind === 'publication' ? { type: 'authorize-publication', commit: artifact.commit, spec: artifact.spec, suite: artifact.suite, receipt: artifact.receipt } : { type: 'revise', scope: artifact.scope, commit: artifact.commit, ...(artifact.scope === 'contract' ? { spec: artifact.nextSpec, specCommit: artifact.nextSpecCommit } : {}) };
      const event = { ...fields, actor: 'human', approvalRef: reference, id: randomUUID(), at: Date.now() } as Event;
      const state = await ledger.owned(id, host, local.generation, current => transition(current, event));
      // Publication retries use the committed decision; an uncertain response
      // cannot authorize another head. The engine reconciles exact remote effects.
      return { run: state.runs[id], authorized: true, action: action === 'publish' ? 'resume exact publication' : 'resume explicitly' };
    });
  };
}
export const decide = decisionCoordinator();
