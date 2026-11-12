import { digest } from '../domain/workflow.js';
import { candidateGit, candidateGitChecked } from './candidate-git.js';

export async function committedSpecDigest(repo: string, commit: string, path: string): Promise<string> {
  const listed = await candidateGit(['ls-tree', '-rz', `${commit}:${path}`], { cwd: repo });
  if (listed.code !== 0 || listed.interrupted) throw new Error('published specification tree is unavailable');
  const files: string[] = [];
  for (const entry of listed.stdout.split('\0').filter(Boolean)) {
    const match = /^100(?:644|755) blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);
    if (!match) throw new Error('unsupported committed specification artifact');
    const size = Number(await candidateGitChecked(['cat-file', '-s', match[1]!], { cwd: repo }));
    if (!Number.isSafeInteger(size) || size > 2_000_000) throw new Error('specification artifact exceeds capacity');
    const result = await candidateGit(['cat-file', 'blob', match[1]!], { cwd: repo, maxBytes: 2_000_001 });
    if (result.code !== 0 || result.interrupted) throw new Error('cannot read committed specification');
    files.push(`${match[2]}\0${digest(result.stdout)}`);
  }
  if (!files.length) throw new Error('empty committed specification');
  return digest(files.sort().join('\n'));
}
