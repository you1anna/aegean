import { digest, identity } from './digest.js';
export interface ContextPart { path: string; text: string; required: boolean }
/** The text that frames one part in a model context. Size checks must count these bytes. */
export const contextFragment = (path: string, text: string): string => `\nFILE ${JSON.stringify(path)}\n${text}\n`;
/** Context policy required-first-v1: required parts first, then by path in English collation. */
export const byContextPriority = (a: Pick<ContextPart, 'path' | 'required'>, b: Pick<ContextPart, 'path' | 'required'>): number => Number(b.required) - Number(a.required) || a.path.localeCompare(b.path, 'en');
/** The record of a complete prompt. The manifest of its source context is recorded separately. */
export const promptRecord = (role: string, prompt: string) => ({ role, bytes: Buffer.byteLength(prompt), hash: digest(prompt), tokenEstimate: null, scope: 'Aegean prompt only; CLI system text and tool schemas excluded' });
export function boundedContext(parts: ContextPart[], limit: number) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('invalid context limit');
  let text = '';
  const paths = new Set<string>();
  const manifest: { path: string; hash: string; bytes: number; required: boolean; included: boolean }[] = [];
  const sorted = [...parts].sort(byContextPriority);
  for (const part of sorted) {
    if (paths.has(part.path)) throw new Error('duplicate context path');
    paths.add(part.path);
    const fragment = contextFragment(part.path, part.text);
    const included = Buffer.byteLength(text) + Buffer.byteLength(fragment) <= limit;
    if (!included && part.required) throw new Error(`required context exceeds ${limit} bytes: ${part.path}`);
    manifest.push({ path: part.path, hash: identity(part.text), bytes: Buffer.byteLength(part.text), required: part.required, included });
    if (included) text += fragment;
  }
  return { text, manifest, bytes: Buffer.byteLength(text), tokenEstimate: null, scope: 'Aegean-supplied text only; CLI system text and tool schemas excluded' };
}
/** Count every tool response; never present a partial response as complete. */
export function toolOutputAllowance(limit: number) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('invalid tool output limit');
  let used = 0, exhausted = false;
  return { check() { if (exhausted) throw new Error('cumulative Builder tool output limit reached'); },
    consume(text: string) {
      if (exhausted || Buffer.byteLength(text) > limit - used) { exhausted = true; throw new Error('cumulative Builder tool output limit reached; complete result withheld'); }
      used += Buffer.byteLength(text);
    }, status: () => ({ used, limit, exhausted }) };
}
