import { candidateGitChecked, candidateGit } from './candidate-git.js';

// A failed client response does not establish that the server rejected a write.
// Read the exact ref; never force, blindly retry, or publish a different HEAD.
export async function pushExact(repo: string, branch: string, commit: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('publication interrupted before push');
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[\w/-]+$/.test(branch) || branch.includes('..')) throw new Error('invalid publication identity');
  const ref = `refs/heads/${branch}`;
  const result = await candidateGit(['push', 'origin', `${commit}:${ref}`], { cwd: repo, ...(signal ? { signal } : {}) });
  if (result.code === 0 && !result.interrupted) return;
  const remote = await candidateGitChecked(['ls-remote', 'origin', ref], { cwd: repo });
  if (remote.split(/\s/)[0] !== commit) throw new Error(`publication unconfirmed for ${ref}; remote ref must be reconciled before retry`);
}
