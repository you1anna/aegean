import { candidateGitChecked, candidateGit } from '../adapters/candidate-git.js';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { checked } from '../adapters/process.js';
import { atomicJson, readJson } from '../adapters/files.js';
import { pushExact } from '../adapters/git-effects.js';
export function assertArchiveOnly(paths: string[]): void {
  if (!paths.length || paths.some(path => !path.startsWith('openspec/') || path.split('/').includes('..'))) throw new Error('archive attempted to modify implementation or an unsafe path');
}
export async function archiveMerged(repo: string, runDirectory: string, id: string, openspec: string, fence: () => Promise<void> = async () => {}, signal?: AbortSignal): Promise<string> {
  await fence();
  await candidateGitChecked(['fetch', 'origin', 'main'], { cwd: repo, ...(signal ? { signal } : {}) });
  const base = await candidateGitChecked(['rev-parse', 'origin/main'], { cwd: repo, ...(signal ? { signal } : {}) });
  const change = await candidateGit(['cat-file', '-e', `${base}:openspec/changes/${id}/proposal.md`], { cwd: repo, ...(signal ? { signal } : {}) });
  if (change.code !== 0) {
    const paths = await candidateGitChecked(['ls-tree', '-r', '--name-only', base, '--', 'openspec/changes/archive'], { cwd: repo, ...(signal ? { signal } : {}) });
    if (paths.split('\n').some(p => p.includes(`-${id}/proposal.md`))) return base;
    throw new Error('merged change is neither active nor archived on main');
  }
  const workspace = join(runDirectory, `archive-${base.slice(0, 12)}`);
  try { await access(workspace); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await fence();
    await candidateGitChecked(['worktree', 'add', '--detach', workspace, base], { cwd: repo, ...(signal ? { signal } : {}) });
  }
  const receiptPath = join(runDirectory, `archive-${base.slice(0, 12)}.json`);
  let receipt: { base: string; tree: string } | undefined;
  try { receipt = await readJson(receiptPath) as typeof receipt; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (!receipt) {
    if (await candidateGitChecked(['status', '--porcelain'], { cwd: workspace, ...(signal ? { signal } : {}) }) || await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: workspace, ...(signal ? { signal } : {}) }) !== base) throw new Error('incomplete archive: preserve and quarantine its worktree before retry; never publish partial output');
    await fence();
    await checked(openspec, ['archive', id, '--yes', '--json'], { cwd: workspace, ...(signal ? { signal } : {}), env: { ...process.env, OPENSPEC_TELEMETRY: '0' } });
    await candidateGitChecked(['add', '-A'], { cwd: workspace, ...(signal ? { signal } : {}) });
    assertArchiveOnly((await candidateGitChecked(['diff', '--cached', '--name-only'], { cwd: workspace, ...(signal ? { signal } : {}) })).split('\n').filter(Boolean));
    receipt = { base, tree: await candidateGitChecked(['write-tree'], { cwd: workspace, ...(signal ? { signal } : {}) }) };
    await atomicJson(receiptPath, receipt);
  }
  await candidateGitChecked(['add', '-A'], { cwd: workspace, ...(signal ? { signal } : {}) });
  if (receipt.base !== base || receipt.tree !== await candidateGitChecked(['write-tree'], { cwd: workspace, ...(signal ? { signal } : {}) })) throw new Error('archive output differs from completed operation receipt');
  const staged = (await candidateGitChecked(['diff', '--cached', '--name-only'], { cwd: workspace, ...(signal ? { signal } : {}) })).split('\n').filter(Boolean);
  if (staged.length) {
    assertArchiveOnly(staged);
    await fence();
    await candidateGitChecked(['commit', '-m', `docs: archive accepted Aegean change ${id}`], { cwd: workspace, ...(signal ? { signal } : {}) });
  }
  const all = (await candidateGitChecked(['diff', '--name-only', base, 'HEAD'], { cwd: workspace, ...(signal ? { signal } : {}) })).split('\n').filter(Boolean); assertArchiveOnly(all);
  // Only the already-approved contract's deterministic documentation archive is
  // eligible for the lightweight direct-main path. This never merges code.
  const commit = await candidateGitChecked(['rev-parse', 'HEAD'], { cwd: workspace, ...(signal ? { signal } : {}) });
  await fence(); await pushExact(workspace, 'main', commit, signal);
  return commit;
}
