import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Result } from './process.js';
import { atomicJson } from './files.js';
export interface Usage { input: number | null; output: number | null; cachedInput: number | null }
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function reportedUsage(text: string): Usage {
  const objects: Record<string, unknown>[] = [];
  try { objects.push(JSON.parse(text)); } catch {
    for (const line of text.split('\n')) { try { objects.push(JSON.parse(line)); } catch { /* non-JSON diagnostic */ } }
  }
  const event = objects.findLast(o => typeof o.usage === 'object' && o.usage !== null);
  const usage = (event?.usage ?? {}) as Record<string, unknown>;
  return { input: count(usage.input_tokens), output: count(usage.output_tokens), cachedInput: count(usage.cached_input_tokens ?? usage.cache_read_input_tokens) };
}
export async function recordUsage(dir: string, role: string, result: Result): Promise<void> {
  await atomicJson(join(dir, 'usage', `${Date.now()}-${randomUUID()}.json`), { role, durationMs: result.durationMs, exit: result.code, interrupted: result.interrupted, tokens: reportedUsage(result.stdout), monetaryCost: null });
}
