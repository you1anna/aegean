import { candidateGitChecked, candidateGit } from '../adapters/candidate-git.js';
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transition } from '../domain/workflow.js';
import { digest } from '../domain/digest.js';
import { POLICY } from '../domain/workflow-policy.js';
import { TERMINAL_STATES, assertRunPolicy, isTerminal, type Event, type Run } from '../domain/run.js';
import { selectModel, identity, type ModelRole, type ModelProfile } from '../domain/model-policy.js';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { sourceContext, scoutContext } from './model-context.js';
import { parseDraft, draftFiles, reviewSummary, responseFault } from '../domain/scout.js';
import { nextSteps, listSteps } from '../domain/next-steps.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { SuiteSchema, ReviewSchema, assertSupportedImage } from '../domain/config.js';
import { builderFindings, findingCounts, publicRequirements, repairFeedback } from '../domain/feedback.js';
import { ALLOWED_PATHS } from '../domain/allowed-paths.js';
import { allowedPaths, pathsOutsideScope, scopeReceipt, recordBaseline, baselineText } from './build-checks.js';
import { GitLedger, assertOwned as assertLedgerOwned } from '../adapters/ledger.js';
import { checked, type Result } from '../adapters/process.js';
import { atomicJson, readJson, treeDigest } from '../adapters/files.js';
import { claudeRole, claudeText, parseJsonAnswer, authentication } from '../adapters/agents.js';
import { approval, github, commandReceipt, publicationCommand, assertApprover } from '../adapters/github.js';
import { verify, cleanupRetained, type Receipt } from '../adapters/verifier.js';
import { hostConfig, stateRoot, binaries, doctor } from './runtime.js';
import { prepareRun } from './prepare.js';
import { operatorStage } from '../adapters/operator-log.js';
import { reserveHost } from '../adapters/host-activity.js';
import { archiveMerged } from './archive.js';
import { budgetStatus, budgetedRole, budgetedExecution, reconcileCompletedBudget, nextArchiveAttempt } from './usage-budget.js';
import { observeRun, finalizeRunEvidence } from './run-evidence.js';
import { executionAuthorization, savedPilot } from './pilot.js';
import { executionLock } from '../adapters/run-lock.js';
import { pushExact, assertRemoteIdentity } from '../adapters/git-effects.js';
import { recordVerifierResource, reconcileVerifierResource } from './verifier-recovery.js';
import { committedSpecDigest } from '../adapters/spec-artifact.js';
import { containedBuilder, reconcileBuilder } from './builder.js';
import { acquireRunPermit, quiescentResources, releaseQuiescentPermits } from './ownership.js';

import { loadLocalRun, suiteRelativePath, specificationFolder, localReview } from './run-record.js';
import { frozenProject, validateLocalSpecApproval, validateLocalPublication } from './decisions.js';
const nowEvent = (type: Event['type'], fields: Record<string, unknown> = {}): Event => ({ id: randomUUID(), at: Date.now(), type, ...fields } as Event);
async function recordContext(path: string, value: unknown): Promise<void> {
  try { await readBoundedEvidenceFile(path, 2_000_000); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await atomicJson(path, value); }
}
export async function saveCandidate(worktree: string, message: string): Promise<string> {
  await candidateGitChecked(['add', '-A', '--', '.', ':(exclude).aegean-tmp'], { cwd: worktree });
  if (await candidateGitChecked(['ls-files', '--', '.aegean-tmp'], { cwd: worktree })) throw new Error('Builder scratch directory must not be tracked');
  const changed = await candidateGit(['diff', '--cached', '--quiet'], { cwd: worktree });
  if (changed.code === 1) await candidateGitChecked(['commit', '-m', message], { cwd: worktree });
  else if (changed.code !== 0) throw new Error('could not inspect candidate changes');
  return candidateGitChecked(['rev-parse', 'HEAD'], { cwd: worktree });
}
async function requireSubscriptions(root: string): Promise<void> {
  const host = await hostConfig(); if (!host.billingConfirmed) throw new Error('Confirm paid overflow is disabled in both accounts before model execution; see OPERATIONS.md');
  const bins = binaries(root); const auth = await authentication(bins.codex, bins.claude);
  if (!auth.codex || !auth.claude) throw new Error('both subscription logins must be verified');
}
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
  let run: Run | undefined;
  let ordinaryReady = false;
  let project: import('../domain/config.js').Project;
  const authorization = () => executionAuthorization(root, dir, local, run!, ordinaryReady);
  const update = async (event: Event) => { const state = await ledger.owned(id, host.host, local.generation, current => transition(current, event)); const updated = state.runs[id]!; assertRunPolicy(updated); run = updated; return run; };
  const assertOwned = async () => {
    if (signal.aborted) throw new Error('interrupted before external effect');
    const current = await ledger.read();
    if (signal.aborted) throw new Error('interrupted before external effect');
    assertLedgerOwned(current, id, host.host, local.generation);
    await assertRemoteIdentity(local.worktree, run!.repository, signal);
    if (!['human-merge-review', 'merged', 'archived'].includes(run!.state) && (await candidateGitChecked(['ls-remote', 'origin', 'refs/heads/main'], { cwd: local.worktree, signal })).split(/\s/)[0] !== local.base) throw new Error('remote base changed before execution');
  };
  const model = async <T>(role: ModelRole, prompt: string, timeoutMs: number, invoke: (timeout: number, deadline: AbortSignal, profile: ModelProfile) => Promise<Result>, parse: (result: Result) => T): Promise<{ value: T; durationMs: number } | undefined> => {
    operatorStage(id, role);
    await assertOwned();
    const limits = await authorization();
    const timeout = Math.min(timeoutMs, limits.remainingMs);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    let result: Result;
    try {
      if (!project.modelExecution) throw new Error('explicit modelExecution policy required');
      const rolePolicy = POLICY.models.roles[role];
      if (Buffer.byteLength(prompt) > rolePolicy.inputBytes) throw new Error(`required ${role} context exceeds ${rolePolicy.inputBytes} bytes`);
      const profile = selectModel(POLICY.models, role, project.modelExecution.task, run!.repairs, toolchain);
      const key = `${role}-${run!.repairs}-${run!.events.length}`;
      await recordContext(join(dir, 'contexts', `${key}.json`), { role, bytes: Buffer.byteLength(prompt), hash: digest(prompt), tokenEstimate: null, scope: 'Aegean prompt only; CLI system text and tool schemas excluded' });
      result = await budgetedRole(dir, key, timeout, limits.budget.maxModelCalls, () => invoke(timeout, deadline, profile), {
        role, profile, budgetIdentity: identity(project.modelExecution.budget), cliVersion: toolchain[profile.provider], contextDigest: digest(prompt), generation: local.generation,
        requireReportedModel: identity(profile) !== identity(rolePolicy.baseline), assertOwned,
      });
    } catch (error) {
      await update(nowEvent('pause', { reason: `${role}: ${(error as Error).message}`, activeMs: 0 }));
      throw error;
    }
    let value: T;
    try {
      if (result.code !== 0 || result.interrupted) throw new Error('interrupted, quota or tool failure');
      value = parse(result);
    } catch (error) {
      const fault = result.code !== 0 || result.interrupted ? 'interrupted or unavailable' : `invalid response (${responseFault(error)})`;
      const failedKind = role === 'scout' ? 'lifecycle' : 'live-loop';
      const failedCheck = role === 'scout' ? 'scout' : role === 'builder' ? 'sandboxed-builder' : role === 'auditor-tests' ? 'independent-auditor' : 'independent-review';
      await observeRun(root, dir, run!, failedKind, failedCheck, 'unknown', { role, code: result.code, interrupted: result.interrupted });
      await update(nowEvent('pause', { reason: `${role}: ${fault}; inspect private effect receipt before explicit resume`, activeMs: result.durationMs }));
      return undefined;
    }
    if (limits.pilot) await observeRun(root, dir, run!, 'real-pilot', 'compatible-project', 'pass', limits.pilot);
    const observation = role === 'scout' ? ['lifecycle', 'scout'] as const : ['live-loop', role === 'builder' ? 'sandboxed-builder' : role === 'auditor-tests' ? 'independent-auditor' : 'independent-review'] as const;
    await observeRun(root, dir, run!, observation[0], observation[1], 'pass', { role, key: run!.events.length, code: result.code });
    await observeRun(root, dir, run!, 'live-loop', 'subscription-only', 'pass', { role, code: result.code });
    return { value, durationMs: result.durationMs };
  };
  try {
    const state = await ledger.read(); const stored = state.runs[id];
    if (stored && isTerminal(stored.state)) return { run: stored };
    if (stored) assertRunPolicy(stored);
    run = stored;
    if (!local.generation && state.owners[id]?.host === host.host) {
      local.generation = state.owners[id]!.generation; await atomicJson(join(dir, 'run.json'), local);
    }
    if (!run) throw new Error('unknown run');
    await acquireRunPermit(ledger, dir, local, host.host);
    await reconcileVerifierResource(dir);
    await reconcileBuilder(dir, local.worktree);
    await reconcileCompletedBudget(dir);
    try { await access(local.worktree); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || run.state !== 'requested') throw e;
      const branch = await candidateGit(['show-ref', '--verify', '--quiet', `refs/heads/${local.branch}`], { cwd: local.repo });
      if (branch.code === 0 && await candidateGitChecked(['rev-parse', local.branch], { cwd: local.repo }) !== local.base) throw new Error('interrupted worktree branch differs from frozen base');
      await candidateGitChecked(['worktree', 'add', ...(branch.code === 0 ? [] : ['-b', local.branch]), local.worktree, branch.code === 0 ? local.branch : local.base], { cwd: local.repo });
    }
    const original = await candidateGit(['show', `${local.base}:aegean.json`], { cwd: local.repo });
    if (original.code !== 0) throw new Error('cannot read frozen project configuration');
    const originalProject = original.stdout;
    if (digest(originalProject) !== run.projectPolicy) throw new Error('frozen project policy differs from run identity');
    if (await readFile(join(local.worktree, 'aegean.json'), 'utf8') !== originalProject) throw new Error('project configuration changed after run creation');
    project = await frozenProject(local, run);
    assertSupportedImage(project);
    const specDir = specificationFolder(local);
    if (run.spec && !['spec-drafted', 'merged', 'archived'].includes(run.state) && await treeDigest(specDir) !== run.spec) throw new Error('approved specification changed; restore it or cancel and request a new approval');
    const readiness = await doctor(root); ordinaryReady = readiness.fullWorkflowReady;
    if (!['human-merge-review', 'merged', 'archived'].includes(run.state)) {
      if (!readiness.prerequisitesReady) return { run, blocked: 'Native containment, verifier and subscription prerequisites must pass before execution; run aegean doctor --json' };
      await authorization();
    }
    if (run.state === 'paused') await update(nowEvent('resume'));
    let drafted: ReturnType<typeof reviewSummary> | undefined;
    if (run.state === 'requested') {
      await requireSubscriptions(root);
      const request = await readFile(local.sourceRequest, 'utf8');
      const { source, prompt } = await scoutContext(local.worktree, project, request);
      await recordContext(join(dir, `contexts/scout-${run.events.length}-source.json`), { ...source, text: undefined });
      const result = await model('scout', prompt, 900000, (timeout, deadline, profile) => claudeRole(bins.claude, prompt, dir, timeout, deadline, profile), r => parseDraft(parseJsonAnswer(claudeText(r))));
      if (!result) return { run };
      const draft = result.value;
      await mkdir(join(specDir, 'specs/contract'), { recursive: true });
      for (const [name, text] of Object.entries(draftFiles(draft))) await writeFile(join(specDir, name), text + '\n');
      drafted = reviewSummary(draft);
      await treeDigest(specDir);
      await candidateGitChecked(['add', '--force', '--', `openspec/changes/${id}`], { cwd: local.worktree });
      const specCommit = await saveCandidate(local.worktree, 'docs: draft Aegean change contract');
      await update(nowEvent('draft', { spec: await treeDigest(specDir), specCommit, activeMs: result.durationMs }));
    }
    if (run.state === 'spec-drafted') {
      const specPath = `openspec/changes/${id}/`;
      const paths = [
        ...((await candidateGit(['diff', '--name-only', '-z', run.revisions ? run.specCommit! : local.base], { cwd: local.worktree })).stdout.split('\0')),
        ...((await candidateGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: local.worktree })).stdout.split('\0')),
      ].filter(Boolean);
      if (paths.some(path => !path.startsWith(specPath))) throw new Error('spec revision contains changes outside its OpenSpec directory; preserve them separately');
      await allowedPaths(specDir).catch(error => { throw new Error(`${ALLOWED_PATHS} in the specification is missing or invalid: ${(error as Error).message}`); });
      await treeDigest(specDir);
      await candidateGitChecked(['add', '--force', '--', specPath], { cwd: local.worktree });
      const specCommit = await saveCandidate(local.worktree, 'docs: revise Aegean change contract');
      const actual = await treeDigest(specDir);
      if (await committedSpecDigest(local.worktree, specCommit, specPath.slice(0, -1)) !== actual) throw new Error('local specification differs from its committed tree; refusing publication and approval');
      if (actual !== run.spec || specCommit !== run.specCommit) await update(nowEvent('draft', { spec: actual, specCommit }));
      if (project.approvalMode === 'local') return { run, action: `Review the local specification with aegean approve --run ${id}`, worktree: local.worktree, specification: specDir + '/', ...(drafted ? { review: drafted } : {}), next: nextSteps(run, { specification: specDir + '/' }) };
      const body = join(dir, 'pr-body.md');
      await writeFile(body, `Aegean specification review.\n\nPublished specification commit: [${specCommit}](https://github.com/${project.repository}/commit/${specCommit})\n\nSpecification digest: ${run.spec}\n\nApprove this exact published revision with:\n\n\`/aegean approve-spec ${run.spec} ${specCommit}\`\n\nImplementation starts only after approval and protected tests.\n`);
      await assertOwned(); await pushExact(local.worktree, local.branch, specCommit, signal, project.repository);
      if (!local.pr) {
        const existing = JSON.parse(await checked('gh', ['pr', 'list', '--repo', project.repository, '--head', local.branch, '--state', 'all', '--json', 'number']));
        if (existing.length) local.pr = existing[0].number;
        else {
          await assertOwned();
          const url = await checked('gh', ['pr', 'create', '--repo', project.repository, '--head', local.branch, '--base', 'main', '--draft', '--title', `Aegean ${id}`, '--body-file', body], { signal });
          local.pr = Number(url.split('/').pop());
        }
        await atomicJson(join(dir, 'run.json'), local);
      }
      await assertOwned();
      await checked('gh', ['pr', 'edit', String(local.pr), '--repo', project.repository, '--body-file', body], { signal });
      const published = await github(`repos/${project.repository}/pulls/${local.pr}`, signal) as { head: { sha: string }; base: { ref: string; repo: { full_name: string } }; merged: boolean };
      if (published.head.sha !== specCommit || published.base.ref !== 'main' || published.base.repo.full_name !== project.repository || published.merged) throw new Error('published specification PR identity differs from the revision awaiting approval');
      const receipt = await approval(project.repository, local.pr!, run.approver, run.spec!, run.updatedAt, specCommit, signal);
      if (!receipt) return { run, pr: local.pr, action: `Human comment required: /aegean approve-spec ${run.spec} ${specCommit}` };
      await update(nowEvent('approve', { spec: run.spec, specCommit, actor: 'human', approvalRef: receipt }));
    }
    if (project.approvalMode === 'local' && !['merged', 'archived'].includes(run.state)) await validateLocalSpecApproval(root, dir, local, run);
    if (run.approvalRef) await observeRun(root, dir, run, 'lifecycle', 'exact-spec-approval', 'pass', run.approvalRef);
    if (['spec-approved', 'tests-staged', 'repair', 'building', 'reviewing'].includes(run.state)) await requireSubscriptions(root);
    const suitePath = join(host.verifierCheckout, suiteRelativePath(run));
    if (run.state === 'spec-approved') {
      const contract = await readFile(join(specDir, 'specs/contract/spec.md'), 'utf8');
      const requirements = publicRequirements(contract);
      const timeout = Math.max(1, Math.min(900000, POLICY.activeTimeoutMs - run.activeMs));
      const prompt = `Act as independent acceptance-test Auditor. You have no implementation context. Return ONLY JSON {schemaVersion:2,spec:${JSON.stringify(run.spec)},cases:[{input:string,stdout:string,exit:number,requirement:string}]}. Derive CLI stdin/stdout acceptance cases from this approved contract. Each requirement must be one of these public requirement IDs: ${JSON.stringify(requirements)}. Do not return free-text feedback.\n${contract}`;
      const result = await model('auditor-tests', prompt, timeout, (limit, deadline, profile) => claudeRole(bins.claude, prompt, dir, limit, deadline, profile), r => {
        const suite = SuiteSchema.parse(parseJsonAnswer(claudeText(r)));
        if (suite.spec !== run!.spec || suite.cases.some(c => !Object.hasOwn(requirements, c.requirement))) throw new Error('Auditor returned stale or unknown public requirement');
        return suite;
      });
      if (!result) return { run };
      const suite = result.value;
      if (suite.spec !== run.spec) throw new Error('Auditor returned stale specification');
      try { if (digest(JSON.stringify(await readJson(suitePath))) !== digest(JSON.stringify(suite))) throw new Error('existing protected suite differs from durable Auditor result'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const relativeSuite = suiteRelativePath(run);
      const dirty = await candidateGit(['status', '--porcelain', '--untracked-files=all'], { cwd: host.verifierCheckout });
      if (dirty.code !== 0 || dirty.stdout.split('\n').filter(Boolean).some(line => line.slice(3) !== relativeSuite)) throw new Error('verifier checkout has unrelated changes; preserve them before resuming');
      if (await candidateGitChecked(['branch', '--show-current'], { cwd: host.verifierCheckout }) !== 'main') throw new Error('verifier checkout must be on main');
      await atomicJson(suitePath, suite); await candidateGitChecked(['add', '--', relativeSuite], { cwd: host.verifierCheckout });
      const changed = await candidateGit(['diff', '--cached', '--quiet'], { cwd: host.verifierCheckout });
      if (changed.code === 1) await candidateGitChecked(['commit', '-m', `acceptance suite for ${id}`], { cwd: host.verifierCheckout });
      else if (changed.code !== 0) throw new Error('cannot inspect staged protected suite');
      await assertOwned(); await pushExact(host.verifierCheckout, 'main', await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: host.verifierCheckout }), signal);
      await update(nowEvent('stage-tests', { suite: digest(JSON.stringify(suite)), spec: run.spec, activeMs: result.durationMs }));
    }
    while (['tests-staged', 'repair', 'building', 'verifying', 'reviewing'].includes(run.state)) {
      if (signal.aborted) throw new Error('cancelled by operator');
      await assertOwned(); await authorization();
      if (run.state === 'tests-staged') {
        const suite = SuiteSchema.parse(await readJson(suitePath));
        if (digest(JSON.stringify(suite)) !== run.suite) throw new Error('protected suite changed after staging');
        const limits = await authorization();
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(limits.remainingMs)]);
        // The protected tests run once on the unchanged base. Public checks do not run here.
        const baselineRun = await budgetedExecution(dir, `baseline-${run.revisions}-${run.events.length}`, limits.remainingMs, async () => {
          const value = await verify(local.worktree, local.base, { ...project, checks: [] }, suite, deadline, undefined, resource => recordVerifierResource(dir, resource));
          return { code: 0, stdout: JSON.stringify(value), stderr: '', interrupted: false, durationMs: value.durationMs };
        });
        const receipt = JSON.parse(baselineRun.stdout) as Receipt;
        const decision = await recordBaseline(dir, run.suite!, local.base, suite, receipt);
        if ('pause' in decision) {
          await update(decision.infrastructureFailure
            ? nowEvent('baseline-inconclusive', { suite: run.suite!, reason: decision.pause, activeMs: receipt.durationMs })
            : nowEvent('pause', { reason: decision.pause, activeMs: receipt.durationMs }));
          break;
        }
        await update(nowEvent('begin-build', { baseline: decision.counts, activeMs: receipt.durationMs }));
      } else if (run.state === 'repair') await update(nowEvent('begin-build'));
      if (run.state === 'building') {
        await ledger.claimBuilder(id, host.host, local.generation);
        let feedback = '';
        if (run.repairReceipt) {
          const lastReview = ReviewSchema.parse(await readJson(join(dir, `review-${run.repairs - 1}.json`)));
          feedback = '\nIndependent review findings: ' + JSON.stringify(builderFindings(lastReview));
          const receipt = await readJson(join(dir, 'repair-feedback.json')) as Receipt;
          if (receipt.spec !== run.spec || receipt.suite !== run.suite || receipt.commit !== run.commit || digest(JSON.stringify(receipt)) !== run.repairReceipt) throw new Error('repair feedback does not match verified evidence');
          feedback += '\nPublic acceptance feedback: ' + JSON.stringify(repairFeedback(receipt.reason, receipt.requirements, await readFile(join(specDir, 'specs/contract/spec.md'), 'utf8'), receipt.outsidePaths));
        }
        const timeout = Math.max(1, POLICY.activeTimeoutMs - run.activeMs);
        const contract = (await Promise.all(['proposal.md', 'design.md', 'tasks.md', 'specs/contract/spec.md', ALLOWED_PATHS].map(async path => `\nFILE ${path}\n${(await readBoundedEvidenceFile(join(specDir, path), POLICY.models.roles.builder.inputBytes).catch(error => { throw new Error(`required Builder context ${path} exceeds ${POLICY.models.roles.builder.inputBytes} bytes or is unreadable: ${error.message}`); })).toString('utf8')}`))).join('');
        const prefix = `Implement only the approved OpenSpec change ${id}. Read its proposal, design, requirements and tasks. Change only the paths that ${ALLOWED_PATHS} allows; verification fails for a change to another path. Keep the contract, aegean.json and agent configuration unchanged. Do not access hidden tests or credentials. Public test commands: ${JSON.stringify(project.checks)}.${feedback}\nAPPROVED CONTRACT:\n${contract}`;
        const source = await sourceContext(local.worktree, project.modelExecution!.task, POLICY.models.roles.builder.inputBytes - Buffer.byteLength(prefix) - 256, false);
        await recordContext(join(dir, 'contexts', `builder-${run.repairs}-${run.events.length}-source.json`), { ...source, text: undefined });
        const prompt = prefix + source.text;
        const result = await model('builder', prompt, timeout, (limit, deadline, profile) => containedBuilder(bins.codex, prompt, local.worktree, dir, id, limit, deadline, profile, POLICY.models.roles.builder.toolOutputBytes), () => true);
        if (await quiescentResources(dir)) await ledger.releaseBuilder(id, host.host, local.generation);
        if (!result) break;
        if (await treeDigest(specDir) !== run.spec) throw new Error('Builder changed approved contract');
        if (await readFile(join(local.worktree, 'aegean.json'), 'utf8') !== originalProject) throw new Error('Builder changed project configuration');
        const commit = await saveCandidate(local.worktree, `build: ${id} attempt ${run.repairs}`);
        await update(nowEvent('candidate', { commit, activeMs: result.durationMs }));
      }
      if (run.state === 'verifying') {
        const receiptPath = join(dir, `verification-${run.repairs}-${run.infrastructureRetries}.json`);
        let previous: Receipt | undefined;
        try { previous = await readJson(receiptPath) as Receipt; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (previous?.retainedResources && !await cleanupRetained(previous)) {
          await update(nowEvent('pause', { reason: `Verifier cleanup remains unresolved; restore Docker and inspect ${receiptPath} before resuming`, activeMs: 0 })); break;
        }
        const suite = SuiteSchema.parse(await readJson(suitePath));
        if (digest(JSON.stringify(suite)) !== run.suite) throw new Error('protected suite changed after staging');
        const limits = await authorization();
        const verificationDeadline = AbortSignal.any([signal, AbortSignal.timeout(limits.remainingMs)]);
        // A change outside the approved allowed paths fails before the protected suite runs.
        const scopeStarted = Date.now();
        const outside = await pathsOutsideScope(local.worktree, local.base, run.commit!, specDir, id, verificationDeadline);
        const verified = outside.length ? { stdout: JSON.stringify(scopeReceipt(run.commit!, suite.spec, run.suite!, project.verifier.image, outside, Date.now() - scopeStarted)) }
          : await budgetedExecution(dir, `verification-${run.revisions}-${run.repairs}-${run.infrastructureRetries}-${run.events.length}`, limits.remainingMs, async () => {
            const value = await verify(local.worktree, run!.commit!, project, suite, verificationDeadline, undefined, resource => recordVerifierResource(dir, resource));
            return { code: 0, stdout: JSON.stringify(value), stderr: '', interrupted: false, durationMs: value.durationMs };
          });
        const receipt = JSON.parse(verified.stdout) as Receipt;
        await atomicJson(receiptPath, receipt);
        await observeRun(root, dir, run, 'real-pilot', 'protected-verification', receipt.outcome === 'pass' ? 'pass' : receipt.outcome === 'fail' ? 'fail' : 'unknown', receipt);
        if (receipt.retainedResources) { await update(nowEvent('pause', { reason: `Verifier cleanup failed; retained resources recorded in ${receiptPath}; restore Docker before resume`, activeMs: receipt.durationMs })); break; }
        if (receipt.outcome === 'cancelled') { await update(nowEvent('pause', { reason: 'Verification cancelled by operator', activeMs: receipt.durationMs })); break; }
        if (receipt.outcome !== 'inconclusive') await atomicJson(join(dir, 'repair-feedback.json'), receipt);
        await update(nowEvent('verification', { commit: run.commit, spec: run.spec, suite: run.suite, outcome: receipt.outcome, receipt: digest(JSON.stringify(receipt)), activeMs: receipt.durationMs }));
      }
      if (run.state === 'reviewing') {
        const limits = await authorization();
        const diffResult = await budgetedExecution(dir, `review-diff-${run.revisions}-${run.repairs}-${run.events.length}`, limits.remainingMs, () => candidateGit(['diff', `${local.base}...${run!.commit}`], { cwd: local.worktree, maxBytes: 200000, signal: AbortSignal.any([signal, AbortSignal.timeout(limits.remainingMs)]) }));
        if (diffResult.interrupted || diffResult.code !== 0) {
          await update(nowEvent('pause', { reason: diffResult.termination === 'output-limit' ? 'Review diff exceeds 200000 bytes; reduce the change or use a reviewed larger-change adapter; partial review is not accepted' : 'Review diff unavailable; inspect diagnostics before resume', activeMs: diffResult.durationMs }));
          break;
        }
        const diff = diffResult.stdout;
        const timeout = Math.max(1, Math.min(900000, POLICY.activeTimeoutMs - run.activeMs));
        const contractText = await readFile(join(specDir, 'specs/contract/spec.md'), 'utf8');
        const verified = await readJson(join(dir, 'repair-feedback.json')) as Receipt;
        if (digest(JSON.stringify(verified)) !== run.receipt) throw new Error('review evidence does not match the verified receipt');
        const evidence = run.verification === 'fail' ? repairFeedback(verified.reason, verified.requirements, contractText, verified.outsidePaths) : [];
        const prompt = [
          'Act as a fresh independent code reviewer. Return ONLY JSON {outcome:"pass"|"repair"|"escalate",findings:[{owner:"builder"|"spec"|"factory",finding:string}]}.',
          'Identify actionable defects and security risks. Give each finding one owner:',
          '- builder: a defect in the code that the Builder can correct within the approved contract.',
          '- spec: the contract is wrong, incomplete or contradicts itself, so no correct code can satisfy it.',
          '- factory: a fault in Aegean itself, for example a protected test or the verifier that checks the wrong thing.',
          'A spec or factory finding stops the run, and the Builder gets no repair. Use these owners only when the evidence shows that the Builder cannot correct the fault.',
          `Deterministic verification was ${run.verification}.${evidence.length ? `\nPUBLIC VERIFICATION FEEDBACK:\n${evidence.join('\n')}` : ''}`,
          `CONTRACT:\n${contractText}`,
          `DIFF:\n${diff}`,
        ].join('\n');
        const result = await model('auditor-review', prompt, timeout, (limit, deadline, profile) => claudeRole(bins.claude, prompt, dir, limit, deadline, profile), r => ReviewSchema.parse(parseJsonAnswer(claudeText(r))));
        if (!result) break;
        const review = result.value; await atomicJson(join(dir, `review-${run.repairs}.json`), review);
        await update(nowEvent('review', { commit: run.commit, outcome: review.outcome, findings: findingCounts(review), activeMs: result.durationMs }));
      }
    }
    if (run.state === 'human-merge-review') {
      if (await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: local.worktree }) !== run.commit || await candidateGitChecked(['status', '--porcelain', '--', '.', ':(exclude).aegean-tmp'], { cwd: local.worktree })) throw new Error('candidate changed after verification; refusing publication');
      if (!run.publicationRef && project.approvalMode === 'local') return { run, action: `Review and publish this exact candidate with aegean publish --run ${id}`, worktree: local.worktree };
      if (!run.publicationRef) {
        const approvalCommand = publicationCommand(run.commit!, run.spec!, run.suite!, run.receipt!);
        const patch = join(dir, 'candidate-review.patch');
        await writeFile(patch, await candidateGitChecked(['diff', `${local.base}...${run.commit}`], { cwd: local.worktree, maxBytes: 200000 }));
        const reviewPath = join(dir, 'publication-review.md');
        const baseline = await baselineText(dir, run.suite);
        await writeFile(reviewPath, `# Candidate publication review\n\nCommit: ${run.commit}\nSpec: ${run.spec}\nSuite: ${run.suite}\nVerification receipt: ${run.receipt}\n\n${baseline ? `${baseline}\n\n` : ''}Review the local candidate at ${local.worktree} and diff at ${patch}.\nPublication can trigger repository CI, credentials, runners and deployment integrations.\nAuthorize this exact candidate only after reviewing that exposure:\n\n${approvalCommand}\n\nPost that comment on https://github.com/${project.repository}/pull/${local.pr}, then resume. This is separate from final merge approval.\n`);
        const receipt = await commandReceipt(project.repository, local.pr!, run.approver, approvalCommand, run.updatedAt, signal);
        if (!receipt) return { run, pr: local.pr, action: `Human publication review required: ${reviewPath}`, approvalCommand };
        await update(nowEvent('authorize-publication', { commit: run.commit, spec: run.spec, suite: run.suite, receipt: run.receipt, actor: 'human', approvalRef: receipt }));
      }
      if (project.approvalMode === 'local') await validateLocalPublication(root, dir, local, run);
      await observeRun(root, dir, run, 'lifecycle', 'publication-approval', 'pass', run.publicationRef);
      await observeRun(root, dir, run, 'real-pilot', 'human-publication', 'pass', run.publicationRef);
      const prPath = `repos/${project.repository}/pulls/${local.pr}`;
      type Pull = { merged: boolean; state?: string; head: { sha: string; ref: string; repo: { full_name: string } }; base: { ref: string; repo: { full_name: string } }; merge_commit_sha: string; merged_by?: unknown };
      const checkPull = (pr: Pull) => {
        if (pr.head.ref !== local.branch || pr.head.repo.full_name !== project.repository || pr.base.ref !== 'main' || pr.base.repo.full_name !== project.repository) throw new Error('PR identity changed; publication refused');
      };
      let pr: Pull | undefined;
      if (local.pr) {
        pr = await github(prPath, signal) as Pull; checkPull(pr);
        if (pr.merged && pr.head.sha !== run.commit) throw new Error('PR was merged with an unverified head; inspect the merge and begin a new reviewed run');
        if (!pr.merged && pr.state === 'closed') throw new Error('PR is closed; explicitly reopen the same PR before resuming');
      }
      if (!pr?.merged) {
        const remoteHead = (await candidateGitChecked(['ls-remote', 'origin', `refs/heads/${local.branch}`], { cwd: local.worktree, signal })).split(/\s/)[0];
        if (remoteHead && ![local.publishedCommit, project.approvalMode === 'github-comments' ? run.specCommit : undefined, run.commit].includes(remoteHead)) throw new Error('PR head changed; use aegean revise to verify the exact edited candidate before publication');
        if (await candidateGitChecked(['ls-remote', 'origin', 'refs/heads/main'], { cwd: local.worktree, signal }).then(value => value.split(/\s/)[0]) !== local.base) throw new Error('remote base changed; preserve this candidate and start a new run from reviewed main');
        await assertOwned(); await pushExact(local.worktree, local.branch, run.commit!, signal, project.repository);
        local.publishedCommit = run.commit!; await atomicJson(join(dir, 'run.json'), local);
        const body = join(dir, 'pr-body.md');
        await writeFile(body, `Aegean bounded CLI candidate.\n\nVerified and independently reviewed commit: ${run.commit}\nSpecification: ${run.spec}\nProtected suite: ${run.suite}\nVerification receipt: ${run.receipt}\n\nThe configured human approver authorized this exact publication. Review and merge manually; changed heads require aegean revise and fresh verification/publication.\n`);
        if (!local.pr) {
          const existing = JSON.parse(await checked('gh', ['pr', 'list', '--repo', project.repository, '--head', local.branch, '--state', 'all', '--json', 'number'], { signal }));
          if (existing.length > 1) throw new Error('multiple PRs match the run branch; inspect their identities');
          if (existing.length) local.pr = existing[0].number;
          else {
            await assertOwned();
            const url = await checked('gh', ['pr', 'create', '--repo', project.repository, '--head', local.branch, '--base', 'main', '--draft', '--title', `Aegean ${id}`, '--body-file', body], { signal });
            local.pr = Number(url.split('/').pop());
          }
          await atomicJson(join(dir, 'run.json'), local);
        }
        await assertOwned(); await checked('gh', ['pr', 'edit', String(local.pr), '--repo', project.repository, '--body-file', body], { signal });
        pr = await github(`repos/${project.repository}/pulls/${local.pr}`, signal) as Pull; checkPull(pr);
        if (pr.head.sha !== run.commit) throw new Error('PR head changed after publication; use aegean revise before any further publication');
      }
      if (pr?.merged && pr.head.sha === run.commit) {
        let human = false; try { assertApprover(pr.merged_by, run.approver); human = true; } catch { /* Other accounts cannot authorize this run's merge. */ }
        if (human) {
          await observeRun(root, dir, run, 'lifecycle', 'human-merge', 'pass', pr);
          await observeRun(root, dir, run, 'real-pilot', 'human-merge', 'pass', pr);
          await update(nowEvent('merged', { commit: run.commit, mergeCommit: pr.merge_commit_sha, actor: 'human' }));
        }
      }
    }
    if (run.state === 'merged') {
      await authorization();
      await assertOwned();
      await candidateGitChecked(['fetch', 'origin', 'main'], { cwd: local.repo });
      await candidateGitChecked(['merge-base', '--is-ancestor', run.mergeCommit!, 'origin/main'], { cwd: local.repo });
      const limits = await authorization();
      const timeout = Math.min(120_000, limits.remainingMs);
      const archiveDeadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
      const fence = async () => { await assertOwned(); if (archiveDeadline.aborted || limits.pilot && Date.now() >= limits.pilot.expiresAt) throw new Error('archive execution budget exhausted or pilot authorization expired'); };
      const attempt = await nextArchiveAttempt(dir);
      const archived = await budgetedExecution(dir, `archive-${attempt}`, timeout, async () => {
        const started = Date.now();
        try { return { code: 0, stdout: await archiveMerged(local.repo, dir, id, bins.openspec, fence, archiveDeadline), stderr: '', interrupted: false, durationMs: Date.now() - started }; }
        catch (error) { return { code: 1, stdout: '', stderr: (error as Error).message, interrupted: archiveDeadline.aborted, durationMs: Date.now() - started }; }
      });
      if (archived.code !== 0 || archived.interrupted) throw new Error(archived.stderr || 'archive interrupted');
      const archiveCommit = archived.stdout;
      await atomicJson(join(dir, 'archive.json'), { archiveCommit, implementationCommit: run.commit, spec: run.spec });
      await observeRun(root, dir, run, 'lifecycle', 'archive', 'pass', archiveCommit);
      await observeRun(root, dir, run, 'real-pilot', 'archive', 'pass', archiveCommit);
      await finalizeRunEvidence(root, dir, run);
      await update(nowEvent('archive'));
    }
    return { run, pr: local.pr, action: run.state === 'human-merge-review' ? 'Review trusted local evidence and merge the PR manually' : 'Inspect status before continuing' };
  } catch (error) {
    if (run && !['paused', 'merged', ...TERMINAL_STATES].includes(run.state) && /context|bounded evidence|file size/i.test((error as Error).message)) await update(nowEvent('pause', { reason: (error as Error).message, activeMs: 0 }));
    throw error;
  } finally {
    try { await releaseQuiescentPermits(ledger, dir, local, host.host); } finally { await release(); }
  }
}
export async function localRuns(): Promise<string[]> { try { return await readdir(join(stateRoot(), 'runs')); } catch { return []; } }
