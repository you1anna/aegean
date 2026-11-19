import { z } from 'zod';
import { ExecutionBudget } from './budgets.js';
import { digest } from './digest.js';
export const PilotLimitsSchema = z.object({
  schemaVersion: z.literal(1), expiresInMinutes: z.number().int().min(1).max(1440),
  maxModelCalls: z.number().int(), activeMinutes: z.number().int().positive(),
  maxRepairs: z.number().int(), maxRevisions: z.number().int(),
}).strict();
export function parsePilotLimits(value: unknown, now = Date.now()) {
  const limits = PilotLimitsSchema.parse(value);
  const budget = ExecutionBudget.parse({ maxModelCalls: limits.maxModelCalls, activeTimeoutMs: limits.activeMinutes * 60_000, maxRepairs: limits.maxRepairs, maxRevisions: limits.maxRevisions });
  const expiresAt = now + limits.expiresInMinutes * 60_000;
  if (!Number.isSafeInteger(expiresAt)) throw new Error('invalid pilot expiry');
  return { expiresAt, budget, limitsDigest: digest(JSON.stringify(limits)) };
}
