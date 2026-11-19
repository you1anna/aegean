import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { candidateGit, candidateGitChecked, saveCandidate } from '../adapters/candidate-git.js';
import { digest } from '../domain/digest.js';
import { POLICY } from '../domain/workflow-policy.js';
import { sourceContext, scoutContext } from './model-context.js';
import { parseDraft, draftFiles, reviewSummary } from '../domain/scout.js';
import { nextSteps } from '../domain/next-steps.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { SuiteSchema, ReviewSchema } from '../domain/config.js';
import { builderFindings, findingCounts, publicRequirements, repairFeedback } from '../domain/feedback.js';
import { ALLOWED_PATHS } from '../domain/allowed-paths.js';
import { allowedPaths, pathsOutsideScope, scopeReceipt, recordBaseline, baselineText } from './build-checks.js';
import { checked } from '../adapters/process.js';
import { atomicJson, readJson, treeDigest } from '../adapters/files.js';
import { claudeRole, claudeText, parseJsonAnswer } from '../adapters/agents.js';
import { approval, github, commandReceipt, publicationCommand, assertApprover } from '../adapters/github.js';
import { verify, cleanupRetained, type Receipt } from '../adapters/verifier.js';
import { requireSubscriptions } from './runtime.js';
import { archiveMerged } from './archive.js';
import { budgetedExecution, nextArchiveAttempt } from './usage-budget.js';
import { observeRun, finalizeRunEvidence } from './run-evidence.js';
import { pushExact } from '../adapters/git-effects.js';
import { recordVerifierResource } from './verifier-recovery.js';
import { committedSpecDigest } from '../adapters/spec-artifact.js';
import { containedBuilder } from './builder.js';
import { quiescentResources } from './ownership.js';
import { validateLocalPublication } from './decisions.js';
import { suiteRelativePath } from './run-record.js';
import { nowEvent, recordContext, type RunSession } from './run-session.js';

// Each stage handles one workflow state of the run in `session`. Its result tells the caller what to do next:
// - NEXT: go on to the next state check;
// - STOP: leave the build loop; the resume then ends with the standard result;
// - { result }: end the resume now with this result.
export const NEXT = 'next', STOP = 'stop';
export interface Done { readonly result: unknown }
export type Drafted = ReturnType<typeof reviewSummary>;

/** requested: the Scout drafts the change contract. */
export async function draftSpecification(session: RunSession): Promise<Done | { drafted: Drafted }> {
  const { root, id, dir, local, bins, specDir, project } = session;
  await requireSubscriptions(root);
  const request = await readFile(local.sourceRequest, 'utf8');
  const { source, prompt } = await scoutContext(local.worktree, project, request);
  await recordContext(join(dir, `contexts/scout-${session.run.events.length}-source.json`), { ...source, text: undefined });
  const result = await session.model('scout', prompt, 900000, (timeout, deadline, profile) => claudeRole(bins.claude, prompt, dir, timeout, deadline, profile), r => parseDraft(parseJsonAnswer(claudeText(r))));
  if (!result) return { result: { run: session.run } };
  const draft = result.value;
  await mkdir(join(specDir, 'specs/contract'), { recursive: true });
  for (const [name, text] of Object.entries(draftFiles(draft))) await writeFile(join(specDir, name), text + '\n');
  const drafted = reviewSummary(draft);
  await treeDigest(specDir);
  await candidateGitChecked(['add', '--force', '--', `openspec/changes/${id}`], { cwd: local.worktree });
  const specCommit = await saveCandidate(local.worktree, 'docs: draft Aegean change contract');
  await session.update(nowEvent('draft', { spec: await treeDigest(specDir), specCommit, activeMs: result.durationMs }));
  return { drafted };
}

/** spec-drafted: commit the human's edits to the contract, then wait for the exact approval. */
export async function reviewSpecification(session: RunSession, drafted: Drafted | undefined): Promise<typeof NEXT | Done> {
  const { id, dir, local, specDir, project, signal } = session;
  const specPath = `openspec/changes/${id}/`;
  const paths = [
    ...((await candidateGit(['diff', '--name-only', '-z', session.run.revisions ? session.run.specCommit! : local.base], { cwd: local.worktree })).stdout.split('\0')),
    ...((await candidateGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: local.worktree })).stdout.split('\0')),
  ].filter(Boolean);
  if (paths.some(path => !path.startsWith(specPath))) throw new Error('spec revision contains changes outside its OpenSpec directory; preserve them separately');
  await allowedPaths(specDir).catch(error => { throw new Error(`${ALLOWED_PATHS} in the specification is missing or invalid: ${(error as Error).message}`); });
  await treeDigest(specDir);
  await candidateGitChecked(['add', '--force', '--', specPath], { cwd: local.worktree });
  const specCommit = await saveCandidate(local.worktree, 'docs: revise Aegean change contract');
  const actual = await treeDigest(specDir);
  if (await committedSpecDigest(local.worktree, specCommit, specPath.slice(0, -1)) !== actual) throw new Error('local specification differs from its committed tree; refusing publication and approval');
  if (actual !== session.run.spec || specCommit !== session.run.specCommit) await session.update(nowEvent('draft', { spec: actual, specCommit }));
  if (project.approvalMode === 'local') return { result: { run: session.run, action: `Review the local specification with aegean approve --run ${id}`, worktree: local.worktree, specification: specDir + '/', ...(drafted ? { review: drafted } : {}), next: nextSteps(session.run, { specification: specDir + '/' }) } };
  const body = join(dir, 'pr-body.md');
  await writeFile(body, `Aegean specification review.\n\nPublished specification commit: [${specCommit}](https://github.com/${project.repository}/commit/${specCommit})\n\nSpecification digest: ${session.run.spec}\n\nApprove this exact published revision with:\n\n\`/aegean approve-spec ${session.run.spec} ${specCommit}\`\n\nImplementation starts only after approval and protected tests.\n`);
  await session.assertOwned(); await pushExact(local.worktree, local.branch, specCommit, signal, project.repository);
  if (!local.pr) {
    const existing = JSON.parse(await checked('gh', ['pr', 'list', '--repo', project.repository, '--head', local.branch, '--state', 'all', '--json', 'number']));
    if (existing.length) local.pr = existing[0].number;
    else {
      await session.assertOwned();
      const url = await checked('gh', ['pr', 'create', '--repo', project.repository, '--head', local.branch, '--base', 'main', '--draft', '--title', `Aegean ${id}`, '--body-file', body], { signal });
      local.pr = Number(url.split('/').pop());
    }
    await atomicJson(join(dir, 'run.json'), local);
  }
  await session.assertOwned();
  await checked('gh', ['pr', 'edit', String(local.pr), '--repo', project.repository, '--body-file', body], { signal });
  const published = await github(`repos/${project.repository}/pulls/${local.pr}`, signal) as { head: { sha: string }; base: { ref: string; repo: { full_name: string } }; merged: boolean };
  if (published.head.sha !== specCommit || published.base.ref !== 'main' || published.base.repo.full_name !== project.repository || published.merged) throw new Error('published specification PR identity differs from the revision awaiting approval');
  const receipt = await approval(project.repository, local.pr!, session.run.approver, session.run.spec!, session.run.updatedAt, specCommit, signal);
  if (!receipt) return { result: { run: session.run, pr: local.pr, action: `Human comment required: /aegean approve-spec ${session.run.spec} ${specCommit}` } };
  await session.update(nowEvent('approve', { spec: session.run.spec, specCommit, actor: 'human', approvalRef: receipt }));
  return NEXT;
}

/** spec-approved: the test Auditor writes the protected suite, which is pushed to the verifier checkout. */
export async function stageTests(session: RunSession, suitePath: string): Promise<typeof NEXT | Done> {
  const { id, dir, specDir, bins, host, signal } = session;
  const contract = await readFile(join(specDir, 'specs/contract/spec.md'), 'utf8');
  const requirements = publicRequirements(contract);
  const timeout = Math.max(1, Math.min(900000, POLICY.activeTimeoutMs - session.run.activeMs));
  const prompt = `Act as independent acceptance-test Auditor. You have no implementation context. Return ONLY JSON {schemaVersion:2,spec:${JSON.stringify(session.run.spec)},cases:[{input:string,stdout:string,exit:number,requirement:string}]}. Derive CLI stdin/stdout acceptance cases from this approved contract. Each requirement must be one of these public requirement IDs: ${JSON.stringify(requirements)}. Do not return free-text feedback.\n${contract}`;
  const result = await session.model('auditor-tests', prompt, timeout, (limit, deadline, profile) => claudeRole(bins.claude, prompt, dir, limit, deadline, profile), r => {
    const suite = SuiteSchema.parse(parseJsonAnswer(claudeText(r)));
    if (suite.spec !== session.run.spec || suite.cases.some(c => !Object.hasOwn(requirements, c.requirement))) throw new Error('Auditor returned stale or unknown public requirement');
    return suite;
  });
  if (!result) return { result: { run: session.run } };
  const suite = result.value;
  if (suite.spec !== session.run.spec) throw new Error('Auditor returned stale specification');
  try { if (digest(JSON.stringify(await readJson(suitePath))) !== digest(JSON.stringify(suite))) throw new Error('existing protected suite differs from durable Auditor result'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const relativeSuite = suiteRelativePath(session.run);
  const dirty = await candidateGit(['status', '--porcelain', '--untracked-files=all'], { cwd: host.verifierCheckout });
  if (dirty.code !== 0 || dirty.stdout.split('\n').filter(Boolean).some(line => line.slice(3) !== relativeSuite)) throw new Error('verifier checkout has unrelated changes; preserve them before resuming');
  if (await candidateGitChecked(['branch', '--show-current'], { cwd: host.verifierCheckout }) !== 'main') throw new Error('verifier checkout must be on main');
  await atomicJson(suitePath, suite); await candidateGitChecked(['add', '--', relativeSuite], { cwd: host.verifierCheckout });
  const changed = await candidateGit(['diff', '--cached', '--quiet'], { cwd: host.verifierCheckout });
  if (changed.code === 1) await candidateGitChecked(['commit', '-m', `acceptance suite for ${id}`], { cwd: host.verifierCheckout });
  else if (changed.code !== 0) throw new Error('cannot inspect staged protected suite');
  await session.assertOwned(); await pushExact(host.verifierCheckout, 'main', await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: host.verifierCheckout }), signal);
  await session.update(nowEvent('stage-tests', { suite: digest(JSON.stringify(suite)), spec: session.run.spec, activeMs: result.durationMs }));
  return NEXT;
}

/** tests-staged: the protected suite runs once on the unchanged base. Public checks do not run here. */
export async function checkBaseline(session: RunSession, suitePath: string): Promise<typeof NEXT | typeof STOP> {
  const { dir, local, project, signal } = session;
  const suite = SuiteSchema.parse(await readJson(suitePath));
  if (digest(JSON.stringify(suite)) !== session.run.suite) throw new Error('protected suite changed after staging');
  const limits = await session.authorization();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(limits.remainingMs)]);
  const baselineRun = await budgetedExecution(dir, `baseline-${session.run.revisions}-${session.run.events.length}`, limits.remainingMs, async () => {
    const value = await verify(local.worktree, local.base, { ...project, checks: [] }, suite, deadline, undefined, resource => recordVerifierResource(dir, resource));
    return { code: 0, stdout: JSON.stringify(value), stderr: '', interrupted: false, durationMs: value.durationMs };
  });
  const receipt = JSON.parse(baselineRun.stdout) as Receipt;
  const decision = await recordBaseline(dir, session.run.suite!, local.base, suite, receipt);
  if ('pause' in decision) {
    await session.update(decision.infrastructureFailure
      ? nowEvent('baseline-inconclusive', { suite: session.run.suite!, reason: decision.pause, activeMs: receipt.durationMs })
      : nowEvent('pause', { reason: decision.pause, activeMs: receipt.durationMs }));
    return STOP;
  }
  await session.update(nowEvent('begin-build', { baseline: decision.counts, activeMs: receipt.durationMs }));
  return NEXT;
}

/** building: the contained Builder implements the contract; its result becomes the candidate commit. */
export async function build(session: RunSession): Promise<typeof NEXT | typeof STOP> {
  const { id, dir, local, specDir, project, bins, ledger, host } = session;
  await ledger.claimBuilder(id, host.host, local.generation);
  let feedback = '';
  if (session.run.repairReceipt) {
    const lastReview = ReviewSchema.parse(await readJson(join(dir, `review-${session.run.repairs - 1}.json`)));
    feedback = '\nIndependent review findings: ' + JSON.stringify(builderFindings(lastReview));
    const receipt = await readJson(join(dir, 'repair-feedback.json')) as Receipt;
    if (receipt.spec !== session.run.spec || receipt.suite !== session.run.suite || receipt.commit !== session.run.commit || digest(JSON.stringify(receipt)) !== session.run.repairReceipt) throw new Error('repair feedback does not match verified evidence');
    feedback += '\nPublic acceptance feedback: ' + JSON.stringify(repairFeedback(receipt.reason, receipt.requirements, await readFile(join(specDir, 'specs/contract/spec.md'), 'utf8'), receipt.outsidePaths));
  }
  const timeout = Math.max(1, POLICY.activeTimeoutMs - session.run.activeMs);
  const contract = (await Promise.all(['proposal.md', 'design.md', 'tasks.md', 'specs/contract/spec.md', ALLOWED_PATHS].map(async path => `\nFILE ${path}\n${(await readBoundedEvidenceFile(join(specDir, path), POLICY.models.roles.builder.inputBytes).catch(error => { throw new Error(`required Builder context ${path} exceeds ${POLICY.models.roles.builder.inputBytes} bytes or is unreadable: ${error.message}`); })).toString('utf8')}`))).join('');
  const prefix = `Implement only the approved OpenSpec change ${id}. Read its proposal, design, requirements and tasks. Change only the paths that ${ALLOWED_PATHS} allows; verification fails for a change to another path. Keep the contract, aegean.json and agent configuration unchanged. Do not access hidden tests or credentials. Public test commands: ${JSON.stringify(project.checks)}.${feedback}\nAPPROVED CONTRACT:\n${contract}`;
  const source = await sourceContext(local.worktree, project.modelExecution!.task, POLICY.models.roles.builder.inputBytes - Buffer.byteLength(prefix) - 256, false);
  await recordContext(join(dir, 'contexts', `builder-${session.run.repairs}-${session.run.events.length}-source.json`), { ...source, text: undefined });
  const prompt = prefix + source.text;
  const result = await session.model('builder', prompt, timeout, (limit, deadline, profile) => containedBuilder(bins.codex, prompt, local.worktree, dir, id, limit, deadline, profile, POLICY.models.roles.builder.toolOutputBytes), () => true);
  if (await quiescentResources(dir)) await ledger.releaseBuilder(id, host.host, local.generation);
  if (!result) return STOP;
  if (await treeDigest(specDir) !== session.run.spec) throw new Error('Builder changed approved contract');
  if (await readFile(join(local.worktree, 'aegean.json'), 'utf8') !== session.originalProject) throw new Error('Builder changed project configuration');
  const commit = await saveCandidate(local.worktree, `build: ${id} attempt ${session.run.repairs}`);
  await session.update(nowEvent('candidate', { commit, activeMs: result.durationMs }));
  return NEXT;
}

/** verifying: a change outside the allowed paths fails before the protected suite runs. */
export async function verifyCandidate(session: RunSession, suitePath: string): Promise<typeof NEXT | typeof STOP> {
  const { root, id, dir, local, specDir, project, signal } = session;
  const receiptPath = join(dir, `verification-${session.run.repairs}-${session.run.infrastructureRetries}.json`);
  let previous: Receipt | undefined;
  try { previous = await readJson(receiptPath) as Receipt; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous?.retainedResources && !await cleanupRetained(previous)) {
    await session.update(nowEvent('pause', { reason: `Verifier cleanup remains unresolved; restore Docker and inspect ${receiptPath} before resuming`, activeMs: 0 })); return STOP;
  }
  const suite = SuiteSchema.parse(await readJson(suitePath));
  if (digest(JSON.stringify(suite)) !== session.run.suite) throw new Error('protected suite changed after staging');
  const limits = await session.authorization();
  const verificationDeadline = AbortSignal.any([signal, AbortSignal.timeout(limits.remainingMs)]);
  const scopeStarted = Date.now();
  const outside = await pathsOutsideScope(local.worktree, local.base, session.run.commit!, specDir, id, verificationDeadline);
  const verified = outside.length ? { stdout: JSON.stringify(scopeReceipt(session.run.commit!, suite.spec, session.run.suite!, project.verifier.image, outside, Date.now() - scopeStarted)) }
    : await budgetedExecution(dir, `verification-${session.run.revisions}-${session.run.repairs}-${session.run.infrastructureRetries}-${session.run.events.length}`, limits.remainingMs, async () => {
      const value = await verify(local.worktree, session.run.commit!, project, suite, verificationDeadline, undefined, resource => recordVerifierResource(dir, resource));
      return { code: 0, stdout: JSON.stringify(value), stderr: '', interrupted: false, durationMs: value.durationMs };
    });
  const receipt = JSON.parse(verified.stdout) as Receipt;
  await atomicJson(receiptPath, receipt);
  await observeRun(root, dir, session.run, 'real-pilot', 'protected-verification', receipt.outcome === 'pass' ? 'pass' : receipt.outcome === 'fail' ? 'fail' : 'unknown', receipt);
  if (receipt.retainedResources) { await session.update(nowEvent('pause', { reason: `Verifier cleanup failed; retained resources recorded in ${receiptPath}; restore Docker before resume`, activeMs: receipt.durationMs })); return STOP; }
  if (receipt.outcome === 'cancelled') { await session.update(nowEvent('pause', { reason: 'Verification cancelled by operator', activeMs: receipt.durationMs })); return STOP; }
  if (receipt.outcome !== 'inconclusive') await atomicJson(join(dir, 'repair-feedback.json'), receipt);
  await session.update(nowEvent('verification', { commit: session.run.commit, spec: session.run.spec, suite: session.run.suite, outcome: receipt.outcome, receipt: digest(JSON.stringify(receipt)), activeMs: receipt.durationMs }));
  return NEXT;
}

/** reviewing: a fresh Auditor reviews the candidate diff against the contract and the verification result. */
export async function reviewCandidate(session: RunSession): Promise<typeof NEXT | typeof STOP> {
  const { dir, local, specDir, bins, signal } = session;
  const limits = await session.authorization();
  const diffResult = await budgetedExecution(dir, `review-diff-${session.run.revisions}-${session.run.repairs}-${session.run.events.length}`, limits.remainingMs, () => candidateGit(['diff', `${local.base}...${session.run.commit}`], { cwd: local.worktree, maxBytes: 200000, signal: AbortSignal.any([signal, AbortSignal.timeout(limits.remainingMs)]) }));
  if (diffResult.interrupted || diffResult.code !== 0) {
    await session.update(nowEvent('pause', { reason: diffResult.termination === 'output-limit' ? 'Review diff exceeds 200000 bytes; reduce the change or use a reviewed larger-change adapter; partial review is not accepted' : 'Review diff unavailable; inspect diagnostics before resume', activeMs: diffResult.durationMs }));
    return STOP;
  }
  const diff = diffResult.stdout;
  const timeout = Math.max(1, Math.min(900000, POLICY.activeTimeoutMs - session.run.activeMs));
  const contractText = await readFile(join(specDir, 'specs/contract/spec.md'), 'utf8');
  const verified = await readJson(join(dir, 'repair-feedback.json')) as Receipt;
  if (digest(JSON.stringify(verified)) !== session.run.receipt) throw new Error('review evidence does not match the verified receipt');
  const evidence = session.run.verification === 'fail' ? repairFeedback(verified.reason, verified.requirements, contractText, verified.outsidePaths) : [];
  const prompt = [
    'Act as a fresh independent code reviewer. Return ONLY JSON {outcome:"pass"|"repair"|"escalate",findings:[{owner:"builder"|"spec"|"factory",finding:string}]}.',
    'Identify actionable defects and security risks. Give each finding one owner:',
    '- builder: a defect in the code that the Builder can correct within the approved contract.',
    '- spec: the contract is wrong, incomplete or contradicts itself, so no correct code can satisfy it.',
    '- factory: a fault in Aegean itself, for example a protected test or the verifier that checks the wrong thing.',
    'A spec or factory finding stops the run, and the Builder gets no repair. Use these owners only when the evidence shows that the Builder cannot correct the fault.',
    `Deterministic verification was ${session.run.verification}.${evidence.length ? `\nPUBLIC VERIFICATION FEEDBACK:\n${evidence.join('\n')}` : ''}`,
    `CONTRACT:\n${contractText}`,
    `DIFF:\n${diff}`,
  ].join('\n');
  const result = await session.model('auditor-review', prompt, timeout, (limit, deadline, profile) => claudeRole(bins.claude, prompt, dir, limit, deadline, profile), r => ReviewSchema.parse(parseJsonAnswer(claudeText(r))));
  if (!result) return STOP;
  const review = result.value; await atomicJson(join(dir, `review-${session.run.repairs}.json`), review);
  await session.update(nowEvent('review', { commit: session.run.commit, outcome: review.outcome, findings: findingCounts(review), activeMs: result.durationMs }));
  return NEXT;
}

type Pull = { merged: boolean; state?: string; head: { sha: string; ref: string; repo: { full_name: string } }; base: { ref: string; repo: { full_name: string } }; merge_commit_sha: string; merged_by?: unknown };

/** human-merge-review: publish the exact candidate after its separate human approval, then record a human merge. */
export async function publishCandidate(session: RunSession): Promise<typeof NEXT | Done> {
  const { root, id, dir, local, project, signal } = session;
  if (await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: local.worktree }) !== session.run.commit || await candidateGitChecked(['status', '--porcelain', '--', '.', ':(exclude).aegean-tmp'], { cwd: local.worktree })) throw new Error('candidate changed after verification; refusing publication');
  if (!session.run.publicationRef && project.approvalMode === 'local') return { result: { run: session.run, action: `Review and publish this exact candidate with aegean publish --run ${id}`, worktree: local.worktree } };
  if (!session.run.publicationRef) {
    const approvalCommand = publicationCommand(session.run.commit!, session.run.spec!, session.run.suite!, session.run.receipt!);
    const patch = join(dir, 'candidate-review.patch');
    await writeFile(patch, await candidateGitChecked(['diff', `${local.base}...${session.run.commit}`], { cwd: local.worktree, maxBytes: 200000 }));
    const reviewPath = join(dir, 'publication-review.md');
    const baseline = await baselineText(dir, session.run.suite);
    await writeFile(reviewPath, `# Candidate publication review\n\nCommit: ${session.run.commit}\nSpec: ${session.run.spec}\nSuite: ${session.run.suite}\nVerification receipt: ${session.run.receipt}\n\n${baseline ? `${baseline}\n\n` : ''}Review the local candidate at ${local.worktree} and diff at ${patch}.\nPublication can trigger repository CI, credentials, runners and deployment integrations.\nAuthorize this exact candidate only after reviewing that exposure:\n\n${approvalCommand}\n\nPost that comment on https://github.com/${project.repository}/pull/${local.pr}, then resume. This is separate from final merge approval.\n`);
    const receipt = await commandReceipt(project.repository, local.pr!, session.run.approver, approvalCommand, session.run.updatedAt, signal);
    if (!receipt) return { result: { run: session.run, pr: local.pr, action: `Human publication review required: ${reviewPath}`, approvalCommand } };
    await session.update(nowEvent('authorize-publication', { commit: session.run.commit, spec: session.run.spec, suite: session.run.suite, receipt: session.run.receipt, actor: 'human', approvalRef: receipt }));
  }
  if (project.approvalMode === 'local') await validateLocalPublication(root, dir, local, session.run);
  await observeRun(root, dir, session.run, 'lifecycle', 'publication-approval', 'pass', session.run.publicationRef);
  await observeRun(root, dir, session.run, 'real-pilot', 'human-publication', 'pass', session.run.publicationRef);
  const prPath = `repos/${project.repository}/pulls/${local.pr}`;
  const checkPull = (pr: Pull) => {
    if (pr.head.ref !== local.branch || pr.head.repo.full_name !== project.repository || pr.base.ref !== 'main' || pr.base.repo.full_name !== project.repository) throw new Error('PR identity changed; publication refused');
  };
  let pr: Pull | undefined;
  if (local.pr) {
    pr = await github(prPath, signal) as Pull; checkPull(pr);
    if (pr.merged && pr.head.sha !== session.run.commit) throw new Error('PR was merged with an unverified head; inspect the merge and begin a new reviewed run');
    if (!pr.merged && pr.state === 'closed') throw new Error('PR is closed; explicitly reopen the same PR before resuming');
  }
  if (!pr?.merged) {
    const remoteHead = (await candidateGitChecked(['ls-remote', 'origin', `refs/heads/${local.branch}`], { cwd: local.worktree, signal })).split(/\s/)[0];
    if (remoteHead && ![local.publishedCommit, project.approvalMode === 'github-comments' ? session.run.specCommit : undefined, session.run.commit].includes(remoteHead)) throw new Error('PR head changed; use aegean revise to verify the exact edited candidate before publication');
    if (await candidateGitChecked(['ls-remote', 'origin', 'refs/heads/main'], { cwd: local.worktree, signal }).then(value => value.split(/\s/)[0]) !== local.base) throw new Error('remote base changed; preserve this candidate and start a new run from reviewed main');
    await session.assertOwned(); await pushExact(local.worktree, local.branch, session.run.commit!, signal, project.repository);
    local.publishedCommit = session.run.commit!; await atomicJson(join(dir, 'run.json'), local);
    const body = join(dir, 'pr-body.md');
    await writeFile(body, `Aegean bounded CLI candidate.\n\nVerified and independently reviewed commit: ${session.run.commit}\nSpecification: ${session.run.spec}\nProtected suite: ${session.run.suite}\nVerification receipt: ${session.run.receipt}\n\nThe configured human approver authorized this exact publication. Review and merge manually; changed heads require aegean revise and fresh verification/publication.\n`);
    if (!local.pr) {
      const existing = JSON.parse(await checked('gh', ['pr', 'list', '--repo', project.repository, '--head', local.branch, '--state', 'all', '--json', 'number'], { signal }));
      if (existing.length > 1) throw new Error('multiple PRs match the run branch; inspect their identities');
      if (existing.length) local.pr = existing[0].number;
      else {
        await session.assertOwned();
        const url = await checked('gh', ['pr', 'create', '--repo', project.repository, '--head', local.branch, '--base', 'main', '--draft', '--title', `Aegean ${id}`, '--body-file', body], { signal });
        local.pr = Number(url.split('/').pop());
      }
      await atomicJson(join(dir, 'run.json'), local);
    }
    await session.assertOwned(); await checked('gh', ['pr', 'edit', String(local.pr), '--repo', project.repository, '--body-file', body], { signal });
    pr = await github(`repos/${project.repository}/pulls/${local.pr}`, signal) as Pull; checkPull(pr);
    if (pr.head.sha !== session.run.commit) throw new Error('PR head changed after publication; use aegean revise before any further publication');
  }
  if (pr?.merged && pr.head.sha === session.run.commit) {
    let human = false; try { assertApprover(pr.merged_by, session.run.approver); human = true; } catch { /* Other accounts cannot authorize this run's merge. */ }
    if (human) {
      await observeRun(root, dir, session.run, 'lifecycle', 'human-merge', 'pass', pr);
      await observeRun(root, dir, session.run, 'real-pilot', 'human-merge', 'pass', pr);
      await session.update(nowEvent('merged', { commit: session.run.commit, mergeCommit: pr.merge_commit_sha, actor: 'human' }));
    }
  }
  return NEXT;
}

/** merged: archive the OpenSpec change on main after the human merge, then close the run's evidence. */
export async function archiveRun(session: RunSession): Promise<void> {
  const { root, id, dir, local, bins, signal } = session;
  await session.authorization();
  await session.assertOwned();
  await candidateGitChecked(['fetch', 'origin', 'main'], { cwd: local.repo });
  await candidateGitChecked(['merge-base', '--is-ancestor', session.run.mergeCommit!, 'origin/main'], { cwd: local.repo });
  const limits = await session.authorization();
  const timeout = Math.min(120_000, limits.remainingMs);
  const archiveDeadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  const fence = async () => { await session.assertOwned(); if (archiveDeadline.aborted || limits.pilot && Date.now() >= limits.pilot.expiresAt) throw new Error('archive execution budget exhausted or pilot authorization expired'); };
  const attempt = await nextArchiveAttempt(dir);
  const archived = await budgetedExecution(dir, `archive-${attempt}`, timeout, async () => {
    const started = Date.now();
    try { return { code: 0, stdout: await archiveMerged(local.repo, dir, id, bins.openspec, fence, archiveDeadline), stderr: '', interrupted: false, durationMs: Date.now() - started }; }
    catch (error) { return { code: 1, stdout: '', stderr: (error as Error).message, interrupted: archiveDeadline.aborted, durationMs: Date.now() - started }; }
  });
  if (archived.code !== 0 || archived.interrupted) throw new Error(archived.stderr || 'archive interrupted');
  const archiveCommit = archived.stdout;
  await atomicJson(join(dir, 'archive.json'), { archiveCommit, implementationCommit: session.run.commit, spec: session.run.spec });
  await observeRun(root, dir, session.run, 'lifecycle', 'archive', 'pass', archiveCommit);
  await observeRun(root, dir, session.run, 'real-pilot', 'archive', 'pass', archiveCommit);
  await finalizeRunEvidence(root, dir, session.run);
  await session.update(nowEvent('archive'));
}
