import { TokenPolicySchema, safeInteger, type TokenPolicy } from './model-policy.js';
export interface TokenReservation { allowance: number; consumed?: number }
export type TokenLedger = Record<string, TokenReservation>;
export function tokenStatus(entries: TokenLedger, policy: TokenPolicy) {
  TokenPolicySchema.parse(policy);
  let consumed = 0, reserved = 0, unknown = 0, exceeded = false;
  for (const item of Object.values(entries)) {
    safeInteger.positive().parse(item.allowance);
    if (item.consumed === undefined) { reserved += item.allowance; unknown++; }
    else { safeInteger.parse(item.consumed); consumed += item.consumed; exceeded ||= item.consumed >= item.allowance; }
  }
  safeInteger.parse(consumed + reserved);
  return { enforcement: policy.enforcement, consumed, reserved, remaining: Math.max(0, policy.maxTokensPerRun - consumed - reserved), unknown, exceeded: exceeded || consumed >= policy.maxTokensPerRun };
}
export function reserveTokens(entries: TokenLedger, key: string, policy: TokenPolicy): TokenLedger {
  if (!/^[\w-]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('invalid token effect key');
  const status = tokenStatus(entries, policy);
  if (policy.enforcement === 'strict') throw new Error('strict token caps unsupported by the pinned subscription adapters; no process started');
  if (Object.hasOwn(entries, key)) return entries;
  if (status.exceeded || status.remaining < policy.maxTokensPerCall) throw new Error('token allowance exhausted; no process started');
  return { ...entries, [key]: { allowance: policy.maxTokensPerCall } };
}
export function settleTokens(entries: TokenLedger, key: string, total: number): TokenLedger {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('invalid token usage');
  const item = entries[key]; if (!item) throw new Error('token reservation missing');
  if (item.consumed !== undefined && item.consumed !== total) throw new Error('conflicting token settlement');
  return { ...entries, [key]: { ...item, consumed: total } };
}
