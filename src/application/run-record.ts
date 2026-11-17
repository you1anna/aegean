import { lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { stateRoot } from './runtime.js';
import { parseReviewNotes, REVIEW_NOTES, type ReviewSummary } from '../domain/scout.js';

const absolute = z.string().max(4096).refine(path => isAbsolute(path) && resolve(path) === path && !/[\0\r\n]/.test(path));
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const LocalRunSchema = z.object({
  id: z.string().regex(/^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
  repo: absolute, worktree: absolute, generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  branch: z.string().max(200), base: sha, pr: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  sourceRequest: absolute, publishedCommit: sha.optional(),
}).strict();
export interface LocalRun { id: string; repo: string; worktree: string; generation: number; branch: string; base: string; pr?: number; sourceRequest: string; publishedCommit?: string }

export async function privateRunDirectory(dir: string): Promise<void> {
  const expected = join(stateRoot(), 'runs', basename(dir));
  if (resolve(dir) !== expected || await realpath(dir) !== expected) throw new Error('run directory must be its canonical private state path');
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error('run directory must be private and may not be a symlink');
}
export async function loadLocalRun(dir: string): Promise<LocalRun> {
  await privateRunDirectory(dir);
  const local = LocalRunSchema.parse(JSON.parse((await readBoundedEvidenceFile(join(dir, 'run.json'), 16_384)).toString('utf8'))) as LocalRun;
  if (local.id !== basename(dir) || local.branch !== `aegean/${local.id}` || local.worktree !== join(dir, 'worktree') || local.sourceRequest !== join(dir, 'request.md')) throw new Error('local run paths or branch differ from the frozen run identity');
  if (await realpath(local.repo) !== local.repo) throw new Error('original repository path changed or contains a symlink');
  try {
    const worktree = await lstat(local.worktree);
    if (!worktree.isDirectory() || worktree.isSymbolicLink() || await realpath(local.worktree) !== local.worktree) throw new Error('candidate worktree path changed or contains a symlink');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await readBoundedEvidenceFile(local.sourceRequest, 60_000);
  return local;
}

/** The folder of the drafted specification in the run worktree. */
export const specificationFolder = (local: Pick<LocalRun, 'worktree' | 'id'>): string => join(local.worktree, 'openspec/changes', local.id);

/** The review summary from the notes file as it is now. Nothing when the folder or the file is not on this host. */
export async function localReview(local: Pick<LocalRun, 'worktree' | 'id'>): Promise<ReviewSummary | undefined> {
  try { return parseReviewNotes((await readBoundedEvidenceFile(join(specificationFolder(local), REVIEW_NOTES), 200_000)).toString('utf8')); }
  catch { return undefined; }
}

/** Each approved contract keeps its own immutable protected suite. */
export function suiteRelativePath(run: { id: string; spec?: string }): string {
  if (!/^run-[a-f0-9-]{36}$/.test(run.id) || !/^[a-f0-9]{64}$/.test(run.spec ?? '')) throw new Error('suite requires exact run and specification identity');
  return `suites/${run.id}-${run.spec}.json`;
}
