import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { checked, command } from '../adapters/process.js';
export function assertArchiveOnly(paths: string[]): void {
  if (!paths.length || paths.some(path => !path.startsWith('openspec/') || path.split('/').includes('..'))) throw new Error('archive attempted to modify implementation or an unsafe path');
}
export async function archiveMerged(repo: string, runDirectory: string, id: string, openspec: string): Promise<string> {
  await checked('git', ['fetch', 'origin', 'main'], { cwd: repo });
  const base = await checked('git', ['rev-parse', 'origin/main'], { cwd: repo });
  const change = await command('git', ['cat-file', '-e', `${base}:openspec/changes/${id}/proposal.md`], { cwd: repo });
  if (change.code !== 0) {
    const paths = await checked('git', ['ls-tree', '-r', '--name-only', base, '--', 'openspec/changes/archive'], { cwd: repo });
    if (paths.split('\n').some(p => p.includes(`-${id}/proposal.md`))) return base;
    throw new Error('merged change is neither active nor archived on main');
  }
  const workspace = join(runDirectory, `archive-${base.slice(0, 12)}`);
  try { await access(workspace); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await checked('git', ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', workspace, base], { cwd: repo });
  }
  const active = await command('git', ['status', '--porcelain'], { cwd: workspace });
  if (!active.stdout) {
    try {
      await access(join(workspace, 'openspec/changes', id, 'proposal.md'));
      await checked(openspec, ['archive', id, '--yes', '--json'], { cwd: workspace, env: { ...process.env, OPENSPEC_TELEMETRY: '0' } });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  await checked('git', ['add', '-A'], { cwd: workspace });
  const staged = (await checked('git', ['diff', '--cached', '--name-only'], { cwd: workspace })).split('\n').filter(Boolean);
  if (staged.length) {
    assertArchiveOnly(staged);
    await checked('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `docs: archive accepted Aegean change ${id}`], { cwd: workspace });
  }
  const all = (await checked('git', ['diff', '--name-only', base, 'HEAD'], { cwd: workspace })).split('\n').filter(Boolean); assertArchiveOnly(all);
  // Only the already-approved contract's deterministic documentation archive is
  // eligible for the lightweight direct-main path. This never merges code.
  await checked('git', ['-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'HEAD:refs/heads/main'], { cwd: workspace });
  return checked('git', ['rev-parse', 'HEAD'], { cwd: workspace });
}
