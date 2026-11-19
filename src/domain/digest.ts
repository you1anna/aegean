import { createHash } from 'node:crypto';

/** The SHA-256 identity of an artifact, as lowercase hex. */
export const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** The SHA-256 identity of a JSON value: object keys sorted, undefined members left out. It differs from `digest` of the same text. */
export const identity = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');

/** Accept only a lowercase hex identity: 64 characters for a digest, 40 for a Git commit. */
export function assertHash(value: string, length = 64): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw new Error('invalid artifact hash');
}
