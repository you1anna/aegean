import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function sourceProvenance(repo) {
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd: repo, maxBuffer: 100_000_000 });
  if (git(['status', '--porcelain', '--untracked-files=all']).length) throw new Error('Release installation requires a clean committed checkout, including untracked files');
  const sourceCommit = git(['rev-parse', 'HEAD']).toString().trim();
  const sourceTree = git(['rev-parse', 'HEAD^{tree}']).toString().trim();
  const files = git(['ls-tree', '-rz', sourceCommit]).toString().split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t'); const [mode, type, object] = entry.slice(0, tab).split(' ');
    if (type !== 'blob') throw new Error('Release sources cannot contain submodules');
    return { name: entry.slice(tab + 1), mode, object };
  }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.name).update('\0');
    if (file.mode === '120000') hash.update('symlink:');
    hash.update(git(['cat-file', 'blob', file.object]));
  }
  return { sourceCommit, sourceTree, sourceHash: hash.digest('hex') };
}
