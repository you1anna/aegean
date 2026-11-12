import { checked } from './process.js';
import { ApproverSchema, GitHubLogin, type Approver } from '../domain/config.js';
export async function github(path: string, signal?: AbortSignal): Promise<unknown> {
  if (!/^(repos\/|users\/[A-Za-z0-9-]+$|user$)/.test(path) || /[\0\r\n]/.test(path)) throw new Error('invalid GitHub API path');
  return JSON.parse(await checked('gh', ['api', path], { maxBytes: 2_000_000, ...(signal ? { signal } : {}) }));
}
function account(value: unknown): Approver {
  if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'User' || !('id' in value) || !('login' in value)) throw new Error('GitHub approver must be a human User with a stable numeric ID');
  const parsed = ApproverSchema.safeParse({ id: value.id, login: value.login });
  if (!parsed.success) throw new Error('GitHub approver must be a human User with a stable numeric ID');
  return parsed.data;
}
/** Login is display metadata: a rename does not change the human's stable ID. */
export function assertApprover(actual: unknown, expected: Approver): Approver {
  const configured = ApproverSchema.parse(expected); const observed = account(actual);
  if (observed.id !== configured.id) throw new Error('GitHub human approver identity does not match the frozen stable account ID');
  return observed;
}
export async function resolveApprover(login: string, signal?: AbortSignal): Promise<Approver> {
  return account(await github(`users/${GitHubLogin.parse(login)}`, signal));
}
export async function authenticatedApprover(expected: Approver, signal?: AbortSignal): Promise<Approver> {
  return assertApprover(await github('user', signal), expected);
}
function humanCommand(comments: readonly unknown[], expected: Approver, body: string, since: number): string | undefined {
  ApproverSchema.parse(expected);
  if (!Number.isFinite(since) || since < 0 || comments.length > 1000 || body.length > 65_536) throw new Error('invalid approval comment query');
  for (const comment of comments) {
    if (typeof comment !== 'object' || comment === null || !('user' in comment) || !('body' in comment) || !('html_url' in comment) || !('created_at' in comment)) continue;
    try { assertApprover(comment.user, expected); } catch { continue; }
    if (typeof comment.body === 'string' && comment.body.trim() === body && typeof comment.created_at === 'string' && Date.parse(comment.created_at) >= Math.floor(since / 1000) * 1000
      && typeof comment.html_url === 'string' && comment.html_url.startsWith('https://') && comment.html_url.length <= 4096) return comment.html_url;
  }
  return undefined;
}
export function approvalFrom(comments: readonly unknown[], approver: Approver, spec: string, since: number, commit?: string): string | undefined {
  return humanCommand(comments, approver, `/aegean approve-spec ${spec}${commit ? ` ${commit}` : ''}`, since);
}
export async function approval(repository: string, pr: number, approver: Approver, spec: string, since: number, commit: string, signal?: AbortSignal): Promise<string | undefined> {
  return commandReceipt(repository, pr, approver, `/aegean approve-spec ${spec} ${commit}`, since, signal);
}
export const publicationCommand = (commit: string, spec: string, suite: string, receipt: string) => `/aegean approve-publish ${commit} ${spec} ${suite} ${receipt}`;
export async function commandReceipt(repository: string, pr: number, approver: Approver, body: string, since: number, signal?: AbortSignal): Promise<string | undefined> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(pr) || pr <= 0) throw new Error('invalid approval repository or PR');
  ApproverSchema.parse(approver);
  for (let page = 1; page <= 10; page++) {
    const comments = await github(`repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`, signal);
    if (!Array.isArray(comments) || comments.length > 100) throw new Error('invalid GitHub approval comments response');
    const found = humanCommand(comments, approver, body, since); if (found) return found;
    if (comments.length < 100) return undefined;
  }
  throw new Error('approval comment scan limit exceeded');
}
