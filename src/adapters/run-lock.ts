import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { atomicJson } from './files.js';
export async function executionLock(dir: string, name: 'executing' | 'configuring' = 'executing'): Promise<() => Promise<void>> {
  const marker = join(dir, name);
  await mkdir(marker).catch(() => { throw new Error('run already executing or interrupted without cleanup; inspect owning process before recovery'); });
  await atomicJson(join(marker, 'owner.json'), { pid: process.pid, startedAt: Date.now() });
  return () => rm(marker, { recursive: true });
}
