import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { candidateGit, candidateGitChecked } from '../adapters/candidate-git.js';
import { committedSpecDigest } from '../adapters/spec-artifact.js';
import { treeDigest } from '../adapters/files.js';
import { identityShape, readBoundedEvidenceFile, releaseIdentity } from '../adapters/acceptance-evidence.js';
import { assertDecision, type HumanDecision } from '../adapters/human-decision.js';
import { ApproverSchema, ProjectSchema, ReviewSchema, SuiteSchema, assertSupportedImage, type Project } from '../domain/config.js';
import { assertRunPolicy, digest, POLICY, type Run } from '../domain/workflow.js';
import { hostConfig } from './runtime.js';
import { privateRunDirectory, suiteRelativePath, type LocalRun } from './run-record.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/); const sha = z.string().regex(/^[a-f0-9]{40}$/);
const scope = {
  schemaVersion: z.literal(1), run: z.string().regex(/^run-[a-f0-9-]{36}$/), host: z.string().uuid(), repository: z.string().min(3).max(256),
  approverId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), projectPolicy: hash, request: hash,
  release: z.object(identityShape).strict(), base: sha, branch: z.string().max(200), spec: hash, specCommit: sha,
};
const SpecArtifactSchema = z.object({ ...scope, kind: z.literal('spec-approval') }).strict();
const PublicationArtifactSchema = z.object({ ...scope, kind: z.literal('publication'), commit: sha, suite: hash, receipt: hash, reviewCommit: sha, review: hash, revisions: z.number().int().nonnegative() }).strict();
const RevisionArtifactSchema = z.object({ ...scope, kind: z.literal('revision'), scope: z.enum(['implementation', 'contract']), previousCommit: sha, commit: sha, nextSpec: hash, nextSpecCommit: sha, revisions: z.number().int().nonnegative(), maxRevisions: z.number().int().nonnegative(), activeMs: z.number().int().nonnegative(), repairs: z.number().int().nonnegative() }).strict();
export type SpecArtifact = z.infer<typeof SpecArtifactSchema>;
export type PublicationArtifact = z.infer<typeof PublicationArtifactSchema>;
export type RevisionArtifact = z.infer<typeof RevisionArtifactSchema>;
export type LocalDecisionArtifact = SpecArtifact | PublicationArtifact | RevisionArtifact;
export const DecisionSchema = z.object({ schemaVersion: z.literal(1), id: z.string().uuid(), action: z.enum(['approve', 'publish', 'pilot', 'revise', 'migrate-control']), run: z.string().max(128), actor: ApproverSchema, binding: hash, decidedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const RecordSchema = z.object({ decision: DecisionSchema, artifact: z.union([SpecArtifactSchema, PublicationArtifactSchema, RevisionArtifactSchema]), review: z.string().max(300_000).optional() }).strict();

/** The raw committed project document is the single project-policy identity. */
export async function frozenProject(local: LocalRun, run: Run, options: { allowMissingWorktree?: boolean } = {}): Promise<Project> {
  assertRunPolicy(run);
  if (local.id !== run.id) throw new Error('local run identity differs from its durable owner');
  const result = await candidateGit(['show', `${local.base}:aegean.json`], { cwd: local.repo, maxBytes: 65_536 });
  if (result.code !== 0 || result.interrupted || digest(result.stdout) !== run.projectPolicy) throw new Error('frozen project policy differs from the run');
  try {
    const current = await readBoundedEvidenceFile(join(local.worktree, 'aegean.json'), 65_536);
    if (digest(current) !== run.projectPolicy) throw new Error('candidate project policy changed');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.allowMissingWorktree || run.state !== 'requested') throw error;
    try { await lstat(local.worktree); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return ProjectSchema.parse(JSON.parse(result.stdout)); throw missing; }
    throw error;
  }
  const project = ProjectSchema.parse(JSON.parse(result.stdout)); assertSupportedImage(project);
  if (project.repository !== run.repository || project.approver.id !== run.approver.id) throw new Error('frozen repository or approver identity differs from the run');
  return project;
}

async function artifactScope(root: string, dir: string, local: LocalRun, run: Run) {
  await privateRunDirectory(dir); await frozenProject(local, run);
  if (basename(dir) !== run.id || local.worktree !== join(dir, 'worktree') || local.sourceRequest !== join(dir, 'request.md')) throw new Error('decision paths differ from their private run directory');
  if (!run.spec || !run.specCommit) throw new Error('run has no exact committed specification');
  return {
    schemaVersion: 1 as const, run: run.id, host: run.host, repository: run.repository,
    approverId: run.approver.id, projectPolicy: run.projectPolicy,
    request: digest(await readBoundedEvidenceFile(local.sourceRequest, 60_000)), release: await releaseIdentity(root),
    base: local.base, branch: local.branch, spec: run.spec, specCommit: run.specCommit,
  };
}
export async function buildSpecArtifact(root: string, dir: string, local: LocalRun, run: Run): Promise<SpecArtifact> {
  const scope = await artifactScope(root, dir, local, run); const path = `openspec/changes/${run.id}`;
  if (await committedSpecDigest(local.worktree, scope.specCommit, path) !== scope.spec || await treeDigest(join(local.worktree, path)) !== scope.spec) throw new Error('specification differs from its frozen committed artifact');
  return SpecArtifactSchema.parse({ ...scope, kind: 'spec-approval' });
}

export async function buildPublicationArtifact(root: string, dir: string, local: LocalRun, run: Run): Promise<PublicationArtifact> {
  const spec = await buildSpecArtifact(root, dir, local, run);
  if (!run.commit || !run.suite || !run.receipt || run.verification !== 'pass' || run.reviewCommit !== run.commit) throw new Error('publication requires exact passing verification and independent review');
  if (await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: local.worktree }) !== run.commit || await candidateGitChecked(['status', '--porcelain', '--', '.', ':(exclude).aegean-tmp'], { cwd: local.worktree })) throw new Error('candidate changed after verification; revise before publication');
  const host = await hostConfig();
  if (host.host !== run.host) throw new Error('publication host differs from run ownership');
  const suite = SuiteSchema.parse(JSON.parse((await readBoundedEvidenceFile(join(host.verifierCheckout, suiteRelativePath(run)), 2_000_000)).toString('utf8')));
  if (suite.spec !== run.spec || digest(JSON.stringify(suite)) !== run.suite) throw new Error('protected suite differs from verified identity');
  const receipt = JSON.parse((await readBoundedEvidenceFile(join(dir, 'repair-feedback.json'), 262_144)).toString('utf8')) as Record<string, unknown>;
  if (!receipt || digest(JSON.stringify(receipt)) !== run.receipt || receipt.schemaVersion !== 1 || receipt.commit !== run.commit || receipt.spec !== run.spec || receipt.suite !== run.suite || receipt.image !== spec.release.image || receipt.outcome !== 'pass' || receipt.failed !== 0 || receipt.retainedResources) throw new Error('verification receipt is stale, incomplete or has unresolved resources');
  const review = ReviewSchema.parse(JSON.parse((await readBoundedEvidenceFile(join(dir, `review-${run.repairs}.json`), 65_536)).toString('utf8')));
  if (review.outcome !== 'pass') throw new Error('independent review is not passing');
  return PublicationArtifactSchema.parse({ ...spec, kind: 'publication', commit: run.commit, suite: run.suite, receipt: run.receipt, reviewCommit: run.reviewCommit, review: digest(JSON.stringify(review)), revisions: run.revisions });
}

export async function buildRevisionArtifact(root: string, dir: string, local: LocalRun, run: Run, revisionScope: 'implementation' | 'contract'): Promise<RevisionArtifact> {
  const scope = await artifactScope(root, dir, local, run);
  if (!run.commit || (run.state !== 'human-merge-review' && !(run.state === 'paused' && run.resumeState === 'human-merge-review')) || run.revisions >= POLICY.maxRevisions) throw new Error('revision requires human review and an available revision budget');
  const commit = await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: local.worktree });
  if (commit === run.commit || await candidateGitChecked(['status', '--porcelain', '--', '.', ':(exclude).aegean-tmp'], { cwd: local.worktree })) throw new Error('revision requires a changed, committed and clean candidate');
  const ancestry = await candidateGit(['merge-base', '--is-ancestor', run.commit, commit], { cwd: local.worktree });
  if (ancestry.code !== 0 || ancestry.interrupted) throw new Error('candidate diverged from its verified head; preserve both histories and review explicitly');
  const path = `openspec/changes/${run.id}`; const nextSpec = await committedSpecDigest(local.worktree, commit, path);
  if (nextSpec !== await treeDigest(join(local.worktree, path))) throw new Error('revision specification differs from its committed tree');
  if (revisionScope === 'implementation' && nextSpec !== run.spec) throw new Error('contract changed; use an explicit contract revision');
  if (revisionScope === 'contract' && nextSpec === run.spec) throw new Error('contract revision requires a changed specification');
  return RevisionArtifactSchema.parse({ ...scope, kind: 'revision', scope: revisionScope, previousCommit: run.commit, commit, nextSpec, nextSpecCommit: revisionScope === 'contract' ? commit : scope.specCommit, revisions: run.revisions, maxRevisions: POLICY.maxRevisions, activeMs: run.activeMs, repairs: run.repairs });
}

async function decisionDirectory(dir: string, create: boolean): Promise<string> {
  await privateRunDirectory(dir); const path = join(dir, 'decisions');
  if (create) await mkdir(path, { mode: 0o700, recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path || (info.mode & 0o077) !== 0) throw new Error('decision directory must be private and may not be a symlink');
  return path;
}
export async function persistLocalDecision(dir: string, decision: HumanDecision, artifact: LocalDecisionArtifact, review?: string): Promise<string> {
  const record = RecordSchema.parse({ decision, artifact, ...(review === undefined ? {} : { review }) });
  if (artifact.run !== basename(dir)) throw new Error('decision belongs to another private run directory');
  const expectedAction = artifact.kind === 'spec-approval' ? 'approve' : artifact.kind === 'publication' ? 'publish' : 'revise';
  assertDecision(record.decision, expectedAction, artifact.run, artifact, { id: artifact.approverId, login: decision.actor.login });
  const directory = await decisionDirectory(dir, true); const bytes = JSON.stringify(record, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 400_000) throw new Error('decision record exceeds supported capacity');
  const path = join(directory, `${record.decision.id}.json`);
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await readBoundedEvidenceFile(path, 400_000)).toString('utf8') !== bytes) throw error;
    return `local:${record.decision.id}:${digest(bytes)}`;
  }
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const folder = await open(directory, 'r'); try { await folder.sync(); } finally { await folder.close(); }
  return `local:${record.decision.id}:${digest(bytes)}`;
}

async function validateLocal(dir: string, reference: string | undefined, action: 'approve' | 'publish', artifact: LocalDecisionArtifact, run: Run): Promise<HumanDecision> {
  const match = /^local:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-f0-9]{64})$/.exec(reference ?? '');
  if (!match) throw new Error('a current local human decision is required');
  const bytes = await readBoundedEvidenceFile(join(await decisionDirectory(dir, false), `${match[1]}.json`), 400_000);
  if (digest(bytes) !== match[2]) throw new Error('local human decision contents changed');
  const saved = RecordSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (saved.decision.id !== match[1] || digest(JSON.stringify(saved.artifact)) !== digest(JSON.stringify(artifact))) throw new Error('local human decision artifact is stale');
  assertDecision(saved.decision, action, run.id, artifact, run.approver);
  return saved.decision;
}
export async function validateLocalSpecApproval(root: string, dir: string, local: LocalRun, run: Run): Promise<HumanDecision> {
  return validateLocal(dir, run.approvalRef, 'approve', await buildSpecArtifact(root, dir, local, run), run);
}
export async function validateLocalPublication(root: string, dir: string, local: LocalRun, run: Run): Promise<HumanDecision> {
  return validateLocal(dir, run.publicationRef, 'publish', await buildPublicationArtifact(root, dir, local, run), run);
}
