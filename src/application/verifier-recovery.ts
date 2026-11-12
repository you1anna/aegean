import { join } from 'node:path';
import { atomicJson, readJson } from '../adapters/files.js';
import { cleanupRetained, type Receipt, type VerifierResource } from '../adapters/verifier.js';
import { command } from '../adapters/process.js';

export const recordVerifierResource = (dir: string, resource: VerifierResource | null) => atomicJson(join(dir, 'verifier-resource.json'), resource);
export async function reconcileVerifierResource(dir: string, execute = command): Promise<void> {
  let resource: VerifierResource | null;
  try { resource = await readJson(join(dir, 'verifier-resource.json')) as VerifierResource | null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!resource) return;
  if (!await cleanupRetained({ retainedResources: resource } as Receipt, execute)) throw new Error('verifier resources remain active or unknown; restore Docker and recover before releasing ownership or resuming');
  await recordVerifierResource(dir, null);
}
