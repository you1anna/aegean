import { checked } from './process.js';
export async function github(path: string): Promise<unknown> {
  if (!/^(repos\/|user$)/.test(path) || /[\r\n]/.test(path)) throw new Error('invalid GitHub API path');
  return JSON.parse(await checked('gh', ['api', path], { maxBytes: 2_000_000 }));
}
interface Comment { user: { login: string; type: string }; body: string; html_url: string; created_at: string }
export function approvalFrom(comments: Comment[], owner: string, spec: string, since: number): string | undefined {
  return comments.find(c => c.user.type === 'User' && c.user.login === owner && c.body.trim() === `/aegean approve-spec ${spec}` && Date.parse(c.created_at) >= since)?.html_url;
}
export async function approval(repository: string, pr: number, spec: string, since: number): Promise<string | undefined> {
  const owner = repository.split('/')[0]!;
  for (let page = 1; page <= 10; page++) {
    const comments = await github(`repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`) as Comment[];
    const found = approvalFrom(comments, owner, spec, since); if (found) return found;
    if (comments.length < 100) return undefined;
  }
  throw new Error('approval comment scan limit exceeded');
}
