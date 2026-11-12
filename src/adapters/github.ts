import { checked } from './process.js';
export async function github(path: string, signal?: AbortSignal): Promise<unknown> {
  if (!/^(repos\/|user$)/.test(path) || /[\r\n]/.test(path)) throw new Error('invalid GitHub API path');
  return JSON.parse(await checked('gh', ['api', path], { maxBytes: 2_000_000, ...(signal ? { signal } : {}) }));
}
interface Comment { user: { login: string; type: string }; body: string; html_url: string; created_at: string }
function humanCommand(comments: Comment[], owner: string, body: string, since: number): string | undefined {
  return comments.find(c => c.user.type === 'User' && c.user.login === owner && c.body.trim() === body && Date.parse(c.created_at) >= Math.floor(since / 1000) * 1000)?.html_url;
}
export function approvalFrom(comments: Comment[], owner: string, spec: string, since: number, commit?: string): string | undefined {
  return humanCommand(comments, owner, `/aegean approve-spec ${spec}${commit ? ` ${commit}` : ''}`, since);
}
export async function approval(repository: string, pr: number, spec: string, since: number, commit: string, signal?: AbortSignal): Promise<string | undefined> {
  return commandReceipt(repository, pr, `/aegean approve-spec ${spec} ${commit}`, since, signal);
}
export const publicationCommand = (commit: string, spec: string, suite: string, receipt: string) => `/aegean approve-publish ${commit} ${spec} ${suite} ${receipt}`;
export async function commandReceipt(repository: string, pr: number, body: string, since: number, signal?: AbortSignal): Promise<string | undefined> {
  const owner = repository.split('/')[0]!;
  for (let page = 1; page <= 10; page++) {
    const comments = await github(`repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`, signal) as Comment[];
    const found = humanCommand(comments, owner, body, since); if (found) return found;
    if (comments.length < 100) return undefined;
  }
  throw new Error('approval comment scan limit exceeded');
}
