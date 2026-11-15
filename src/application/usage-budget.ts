import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { POLICY, POLICY_IDENTITY } from '../domain/workflow.js';
import { atomicJson } from '../adapters/files.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';
import { executionLock } from '../adapters/run-lock.js';
import type { Result } from '../adapters/process.js';
import { TokenPolicySchema, identity, type TokenPolicy } from '../domain/model-policy.js';
import { reserveTokens, settleTokens, tokenStatus, type TokenLedger } from '../domain/token-budget.js';
import { CallIdentitySchema, settleModelUsage, type ModelCall } from './model-call.js';
import { roleResult } from './role-result.js';
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Budget = z.object({ schemaVersion: z.literal(1), policyIdentity: z.string(), tokenPolicy: TokenPolicySchema.optional(), reservations: z.record(z.string().regex(/^[\w-]+$/), z.object({ kind: z.enum(['model', 'execution']), timeoutMs: integer.positive(), durationMs: integer.optional(), call: CallIdentitySchema.optional(), allowance: integer.positive().optional(), consumed: integer.optional() }).strict()) }).strict().superRefine((value, context) => {
  if (value.tokenPolicy && Object.values(value.reservations).some(item => item.kind === 'model' && (!item.call || item.allowance === undefined))) context.addIssue({ code: 'custom', message: 'model token reservation is incomplete' });
});
async function read(dir: string) {
  const value = Budget.parse(JSON.parse((await readBoundedEvidenceFile(join(dir, 'model-budget.json'), 65_536)).toString('utf8')));
  if (value.policyIdentity !== POLICY_IDENTITY) throw new Error('usage budget policy changed; use the original release');
  if (Object.keys(value.reservations).length > 128) throw new Error('invalid usage budget capacity');
  return value;
}
/** Only run creation initializes accounting. Missing accounting is never reset. */
export async function initializeBudget(dir: string, tokenPolicy?: TokenPolicy): Promise<void> {
  const handle = await open(join(dir, 'model-budget.json'), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, policyIdentity: POLICY_IDENTITY, reservations: {}, ...(tokenPolicy ? { tokenPolicy: TokenPolicySchema.parse(tokenPolicy) } : {}) })); await handle.sync(); } finally { await handle.close(); }
}
function tokenEntries(value: Awaited<ReturnType<typeof read>>): TokenLedger {
  return Object.fromEntries(Object.entries(value.reservations).filter(([, item]) => item.kind === 'model' && item.allowance !== undefined).map(([key, item]) => [key, { allowance: item.allowance!, ...(item.consumed === undefined ? {} : { consumed: item.consumed }) }]));
}
export async function budgetStatus(dir: string) {
  const value = await read(dir); const entries = Object.values(value.reservations);
  return { tokens: value.tokenPolicy ? tokenStatus(tokenEntries(value), value.tokenPolicy) : null, calls: entries.filter(item => item.kind === 'model').length, maxCalls: POLICY.maxModelCalls, activeMs: entries.reduce((sum, item) => sum + (item.durationMs ?? item.timeoutMs), 0), uncertain: entries.filter(item => item.durationMs === undefined).length };
}
/** Short reservation lock, never held during a provider call; outer run lock owns execution. */
async function budgetedEffect(dir: string, key: string, timeoutMs: number, maxCalls: number, invoke: () => Promise<Result>, kind: 'model' | 'execution', call?: ModelCall): Promise<Result> {
  if (!/^[\w-]+$/.test(key) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxCalls) || maxCalls <= 0 || maxCalls > POLICY.maxModelCalls) throw new Error('invalid usage budget');
  if (kind === 'model' && !call) throw new Error('model identity required before execution');
  if (call) await call.assertOwned();
  const release = await executionLock(dir, 'budget-lock');
  try {
    const value = await read(dir);
    if (call && identity(value.tokenPolicy) !== call.budgetIdentity) throw new Error('token budget policy differs from frozen project');
    if (!Object.hasOwn(value.reservations, key)) {
      if (Object.keys(value.reservations).length >= 128) throw new Error('execution effect capacity exhausted');
      if (kind === 'model' && Object.values(value.reservations).filter(item => item.kind === 'model').length >= maxCalls) throw new Error('model-call usage budget exhausted; no process started');
      if (call) {
        if (!value.tokenPolicy) throw new Error('explicit token policy required before model execution');
        const tokens = tokenEntries(value);
        if (tokenStatus(tokens, value.tokenPolicy).unknown) throw new Error('unknown token usage; reconcile prior effects before another call');
        const reserved = reserveTokens(tokens, key, value.tokenPolicy)[key]!;
        value.reservations[key] = { kind, timeoutMs, call: CallIdentitySchema.parse(callIdentity(call)), allowance: reserved.allowance };
      } else {
        if (kind === 'model' && value.tokenPolicy) throw new Error('model identity required before token admission');
        value.reservations[key] = { kind, timeoutMs };
      }
      await atomicJson(join(dir, 'model-budget.json'), value);
    } else {
      const saved = JSON.parse((await readBoundedEvidenceFile(join(dir, 'effects', `${key}.json`), 8_000_000).catch(() => { throw new Error(`Unknown outcome for ${key}; reservation remains charged; recover explicitly`); })).toString('utf8'));
      const original = value.reservations[key]!.call;
      const replay = saved.key === key && saved.status === 'completed' && saved.result;
      if (call && identity({ ...original, generation: call.generation }) !== identity({ ...callIdentity(call), ...(replay && original ? { contextDigest: original.contextDigest } : {}) })) throw new Error('model effect identity changed');
      if (value.reservations[key]!.kind !== kind) throw new Error('effect kind changed');
      // A reservation without an effect receipt is an uncertain launch, never
      // permission to invoke again (including interruption before roleResult).
      try { await readBoundedEvidenceFile(join(dir, 'effects', `${key}.json`), 8_000_000); }
      catch { throw new Error(`Unknown outcome for ${key}; reservation remains charged; recover explicitly`); }
    }
  } finally { await release(); }
  const result = await roleResult(dir, key, timeoutMs, async () => { if (call) await call.assertOwned(); return invoke(); });
  if (call) await call.assertOwned();
  const finish = await executionLock(dir, 'budget-lock');
  try {
    const value = await read(dir); const reservation = value.reservations[key];
    if (!reservation) throw new Error('usage reservation missing after execution');
    if (!Number.isSafeInteger(result.durationMs) || result.durationMs < 0) throw new Error('invalid role duration');
    reservation.durationMs = result.durationMs;
    if (call && reservation.call) {
      const total = await settleModelUsage(dir, key, reservation.call, result, POLICY_IDENTITY);
      if (total !== null) reservation.consumed = settleTokens(tokenEntries(value), key, total)[key]!.consumed!;
    }
    await atomicJson(join(dir, 'model-budget.json'), value);
    if (call && reservation.consumed === undefined) throw new Error('unknown token usage; reservation remains charged');
    if (call && value.tokenPolicy && tokenStatus(tokenEntries(value), value.tokenPolicy).exceeded) throw new Error('token allowance reached or exceeded; no further model call allowed');
  } finally { await finish(); }
  return result;
}

/** Explicit recovery only: the caller has proved the coordinator stopped. */
export async function recoverBudgetLock(dir: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  const marker = join(dir, 'budget-lock');
  let owner: { pid: number };
  try { owner = JSON.parse((await readBoundedEvidenceFile(join(marker, 'owner.json'), 1024)).toString('utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { lstat } = await import('node:fs/promises');
    try { await lstat(marker); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return; throw missing; }
    throw new Error('budget lock owner missing; manual process audit required');
  }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('invalid budget lock owner');
  try { process.kill(owner.pid, 0); throw new Error('budget lock owner still alive'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  await rm(marker, { recursive: true });
}
export async function settleUnknownBudget(dir: string): Promise<void> {
  const value = await read(dir);
  for (const reservation of Object.values(value.reservations)) reservation.durationMs ??= reservation.timeoutMs;
  await atomicJson(join(dir, 'model-budget.json'), value);
}

export const budgetedRole = (dir: string, key: string, timeoutMs: number, maxCalls: number, invoke: () => Promise<Result>, call: ModelCall) => budgetedEffect(dir, key, timeoutMs, maxCalls, invoke, 'model', call);
export const budgetedExecution = (dir: string, key: string, timeoutMs: number, invoke: () => Promise<Result>) => budgetedEffect(dir, key, timeoutMs, POLICY.maxModelCalls, invoke, 'execution');

/** Reconcile a confirmed result before classifying an interrupted launch. */
export async function reconcileCompletedBudget(dir: string): Promise<void> {
  const value = await read(dir);
  for (const [key, reservation] of Object.entries(value.reservations)) {
    if (reservation.durationMs !== undefined && (!reservation.call || reservation.consumed !== undefined)) continue;
    let saved;
    try { saved = JSON.parse((await readBoundedEvidenceFile(join(dir, 'effects', `${key}.json`), 8_000_000)).toString('utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (saved.key !== key) throw new Error('effect identity differs from reservation');
    if (saved.status === 'completed') {
      const duration = saved.result?.durationMs;
      if (!Number.isSafeInteger(duration) || duration < 0) throw new Error('invalid completed effect duration');
      reservation.durationMs = duration;
      if (reservation.call) {
        const total = await settleModelUsage(dir, key, reservation.call, saved.result, POLICY_IDENTITY);
        if (total !== null) reservation.consumed = settleTokens(tokenEntries(value), key, total)[key]!.consumed!;
      }
    }
  }
  await atomicJson(join(dir, 'model-budget.json'), value);
}

function callIdentity(call: ModelCall) { const { assertOwned: _fence, ...value } = call; return value; }

export async function nextArchiveAttempt(dir: string): Promise<number> {
  const value = await read(dir);
  const attempts = Object.entries(value.reservations).filter(([key]) => key.startsWith('archive-'));
  if (attempts.some(([, item]) => item.durationMs === undefined)) throw new Error('unknown archive outcome; explicit recovery required');
  if (attempts.length > POLICY.maxInfrastructureRetries) throw new Error('archive retry budget exhausted');
  return attempts.length;
}
