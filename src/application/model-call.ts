import { join } from 'node:path';
import { z } from 'zod';
import { ModelProfileSchema, safeInteger } from '../domain/model-policy.js';
import { providerUsage } from '../adapters/usage.js';
import { atomicJson } from '../adapters/files.js';
import type { Result } from '../adapters/process.js';
export const CallIdentitySchema = z.object({ role: z.enum(['scout', 'builder', 'auditor-tests', 'auditor-review']), profile: ModelProfileSchema, cliVersion: z.string().min(1), budgetIdentity: z.string().regex(/^[a-f0-9]{64}$/), contextDigest: z.string().regex(/^[a-f0-9]{64}$/), generation: safeInteger, requireReportedModel: z.boolean() }).strict();
export type CallIdentity = z.infer<typeof CallIdentitySchema>;
export interface ModelCall extends CallIdentity { assertOwned: () => Promise<void> }
export async function settleModelUsage(dir: string, key: string, call: CallIdentity, result: Result, policyIdentity: string): Promise<number | null> {
  const measured = providerUsage(result.stdout, call.profile.provider);
  const usage = { ...measured, total: result.interrupted || result.code !== 0 ? null : measured.total };
  await atomicJson(join(dir, 'usage', `${key}.json`), { schemaVersion: 2, effect: key, ...call, policyIdentity, reportedModel: usage.model, tokens: usage, durationMs: result.durationMs, exit: result.code, interrupted: result.interrupted, monetaryCost: null });
  if (usage.model !== null && usage.model !== call.profile.model || call.requireReportedModel && usage.model === null) throw new Error('model identity unavailable or changed; inspect the effect before any further call');
  return usage.total;
}
