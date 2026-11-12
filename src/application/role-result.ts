import { join } from 'node:path';
import { atomicJson, readJson } from '../adapters/files.js';
import type { Result } from '../adapters/process.js';
import { recordUsage } from '../adapters/usage.js';
export interface RoleRecord { key: string; startedAt: number; timeoutMs: number; status: 'running' | 'completed'; result?: Result }
export async function roleResult(dir: string, key: string, timeoutMs: number, invoke: () => Promise<Result>): Promise<Result> {
  if (!/^[\w-]+$/.test(key)) throw new Error('invalid role effect key');
  const path = join(dir, 'effects', `${key}.json`);
  let saved: RoleRecord | undefined;
  try { saved = await readJson(path) as RoleRecord; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (saved) {
    if (saved.key !== key || saved.status !== 'completed' || !saved.result) throw new Error(`Unknown outcome for ${key}; inspect child processes, then use aegean recover --run ID --confirm-stopped`);
    return saved.result;
  }
  const intent: RoleRecord = { key, startedAt: Date.now(), timeoutMs, status: 'running' };
  await atomicJson(path, intent);
  const result = await invoke();
  await atomicJson(path, { ...intent, status: 'completed', result });
  await recordUsage(dir, key, result);
  return result;
}
