import { z } from 'zod';
import { POLICY } from './workflow-policy.js';
import type { Run } from './run.js';
export const ExecutionBudget = z.object({
  maxModelCalls: z.number().int().min(1).max(POLICY.maxModelCalls),
  activeTimeoutMs: z.number().int().min(1).max(POLICY.activeTimeoutMs),
  maxRepairs: z.number().int().min(0).max(POLICY.maxRepairs),
  maxRevisions: z.number().int().min(0).max(POLICY.maxRevisions),
}).strict();
export type ExecutionBudget = z.infer<typeof ExecutionBudget>;
export const defaultBudget: ExecutionBudget = ExecutionBudget.parse({ maxModelCalls: POLICY.maxModelCalls, activeTimeoutMs: POLICY.activeTimeoutMs, maxRepairs: POLICY.maxRepairs, maxRevisions: POLICY.maxRevisions });
export function remainingExecution(run: Run, budget: ExecutionBudget, accountedMs: number, now: number, expiresAt = Number.MAX_SAFE_INTEGER): number {
  ExecutionBudget.parse(budget);
  if (run.repairs > budget.maxRepairs || run.revisions > budget.maxRevisions) throw new Error('repair or revision budget exhausted');
  if (!Number.isSafeInteger(accountedMs) || accountedMs < 0) throw new Error('invalid active usage accounting');
  const remaining = Math.min(budget.activeTimeoutMs - Math.max(run.activeMs, accountedMs), expiresAt - now);
  if (remaining <= 0) throw new Error('active budget exhausted or pilot authorization expired');
  return remaining;
}
