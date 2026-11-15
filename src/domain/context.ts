import { identity } from './model-policy.js';
export interface ContextPart { path: string; text: string; required: boolean }
export function boundedContext(parts: ContextPart[], limit: number) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('invalid context limit');
  let text = '';
  const paths = new Set<string>();
  const manifest: { path: string; hash: string; bytes: number; required: boolean; included: boolean }[] = [];
  const sorted = [...parts].sort((a, b) => Number(b.required) - Number(a.required) || a.path.localeCompare(b.path, 'en'));
  for (const part of sorted) {
    if (paths.has(part.path)) throw new Error('duplicate context path');
    paths.add(part.path);
    const fragment = `\nFILE ${JSON.stringify(part.path)}\n${part.text}\n`;
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
