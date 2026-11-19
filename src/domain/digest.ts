import { createHash } from 'node:crypto';

/** The SHA-256 identity of an artifact, as lowercase hex. */
export const digest = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** Accept only a lowercase hex identity: 64 characters for a digest, 40 for a Git commit. */
export function assertHash(value: string, length = 64): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw new Error('invalid artifact hash');
}
