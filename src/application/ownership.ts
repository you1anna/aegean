import { join } from 'node:path';
import { atomicJson } from '../adapters/files.js';
import { assertOwned, type GitLedger } from '../adapters/ledger.js';
import { readBoundedEvidenceFile } from '../adapters/acceptance-evidence.js';

interface LocalOwner { id: string; generation: number }
const readRecord = async (path: string): Promise<unknown> => JSON.parse((await readBoundedEvidenceFile(path, 65_536)).toString('utf8'));
export async function acquireRunPermit<T extends LocalOwner>(ledger: GitLedger, dir: string, local: T, host: string): Promise<void> {
  try { if (await readRecord(join(dir, 'permit-intent.json')) !== null) throw new Error('unresolved permit intent; explicitly recover before reacquiring'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const state = await ledger.read(); const run = assertOwned(state, local.id, host, local.generation, false);
  const permit = state.repositories[run.repository.toLowerCase()];
  if (permit?.run === local.id && permit.host === host && permit.generation === local.generation) return;
  if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('control revision exhausted; permit cannot be reacquired');
  await atomicJson(join(dir, 'permit-intent.json'), { run: local.id, host, previous: local.generation, grant: state.revision + 1 });
  const next = await ledger.resumeOwned(local.id, host, local.generation, state.revision);
  local.generation = next.owners[local.id]!.generation;
  await atomicJson(join(dir, 'run.json'), local);
  await atomicJson(join(dir, 'permit-intent.json'), null);
}

/** Called only after explicit local process recovery established the old coordinator stopped. */
export async function reconcilePermitIntent<T extends LocalOwner>(ledger: GitLedger, dir: string, local: T, host: string): Promise<void> {
  let intent: { run: string; host: string; previous: number; grant: number } | null;
  try { intent = await readRecord(join(dir, 'permit-intent.json')) as typeof intent; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (intent === null) return;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).length !== 4 || intent.run !== local.id || intent.host !== host || !Number.isSafeInteger(intent.previous) || intent.previous <= 0 || !Number.isSafeInteger(intent.grant) || intent.grant <= intent.previous || ![intent.previous, intent.grant].includes(local.generation)) throw new Error('invalid or unrelated permit recovery intent');
  const state = await ledger.read(); const owner = state.owners[local.id];
  if (!owner || owner.host !== host || ![intent.previous, intent.grant].includes(owner.generation)) throw new Error('permit recovery cannot adopt a generation other than its exact recorded grant');
  const run = assertOwned(state, local.id, host, owner.generation, false);
  if (owner.generation !== intent.previous && state.repositories[run.repository.toLowerCase()]?.generation !== owner.generation) throw new Error('permit recovery has no matching confirmed repository grant');
  local.generation = owner.generation; await atomicJson(join(dir, 'run.json'), local);
  await atomicJson(join(dir, 'permit-intent.json'), null);
}

export async function quiescentResources(dir: string): Promise<boolean> {
  for (const name of ['builder-resource.json', 'verifier-resource.json', 'builder-import.json', 'permit-intent.json']) {
    try { if (await readRecord(join(dir, name)) !== null) return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return true;
}

export async function releaseQuiescentPermits(ledger: GitLedger, dir: string, local: LocalOwner, host: string): Promise<void> {
  if (!await quiescentResources(dir)) return;
  const state = await ledger.read(); const owner = state.owners[local.id];
  if (owner?.host === host && owner.generation === local.generation && (state.builder?.run === local.id || state.repositories[state.runs[local.id]!.repository.toLowerCase()]?.run === local.id)) {
    await ledger.releasePermits(local.id, host, local.generation);
  }
}
