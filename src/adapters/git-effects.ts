import { candidateGitChecked, candidateGit } from './candidate-git.js';

export async function assertRemoteIdentity(repo: string, repository?: string, signal?: AbortSignal): Promise<void> {
  const options = { cwd: repo, ...(signal ? { signal } : {}) };
  const fetch = await candidateGitChecked(['remote', 'get-url', '--all', 'origin'], options);
  const push = await candidateGitChecked(['remote', 'get-url', '--push', '--all', 'origin'], options);
  if (!fetch || fetch.includes('\n') || push !== fetch) throw new Error('publication remote has multiple or differing fetch/push destinations');
  if (repository && ![`git@github.com:${repository}.git`, `https://github.com/${repository}.git`, `https://github.com/${repository}`].includes(fetch)) throw new Error('remote repository identity changed');
}

// A failed client response does not establish that the server rejected a write.
// Read the exact ref; never force, blindly retry, or publish a different HEAD.
export async function pushExact(repo: string, branch: string, commit: string, signal?: AbortSignal, repository?: string): Promise<void> {
  await assertRemoteIdentity(repo, repository, signal);
  if (signal?.aborted) throw new Error('publication interrupted before push');
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[\w/-]+$/.test(branch) || branch.includes('..')) throw new Error('invalid publication identity');
  const ref = `refs/heads/${branch}`;
  const result = await candidateGit(['push', 'origin', `${commit}:${ref}`], { cwd: repo, ...(signal ? { signal } : {}) });
  if (result.code === 0 && !result.interrupted) return;
  await assertRemoteIdentity(repo, repository);
  const remote = await candidateGitChecked(['ls-remote', 'origin', ref], { cwd: repo });
  if (remote.split(/\s/)[0] !== commit) throw new Error(`publication unconfirmed for ${ref}; remote ref must be reconciled before retry`);
}
