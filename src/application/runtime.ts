import { matchesVersion } from '../../scripts/cli-version.mjs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from '../adapters/files.js';
import { authentication } from '../adapters/agents.js';
import { command } from '../adapters/process.js';
import { docker } from '../adapters/verifier.js';
import { z } from 'zod';
import toolchain from '../../toolchain.json' with { type: 'json' };
import packageInfo from '../../package.json' with { type: 'json' };
import { acceptedRelease, acceptedPrerequisites } from '../adapters/acceptance.js';
import { executionLock } from '../adapters/run-lock.js';
export const stateRoot = () => join(homedir(), '.local/state/aegean');
export const HostSchema = z.object({ schemaVersion: z.literal(1), host: z.string().uuid(), controlRemote: z.string().regex(/^(git@github\.com:|https:\/\/github\.com\/)[\w.-]+\/[\w.-]+\.git$/), verifierCheckout: z.string().startsWith('/'), image: z.string().regex(/^[\w./:-]+@sha256:[a-f0-9]{64}$/).optional(), excludedRoots: z.array(z.string().startsWith('/')).min(1).optional(), billingConfirmed: z.boolean() }).strict();
export type HostConfig = z.infer<typeof HostSchema>;
export async function hostConfig(): Promise<HostConfig> {
  return HostSchema.parse(await readJson(join(stateRoot(), 'settings.json')));
}
interface ConfigureOptions { controlRemote?: string | undefined; verifierCheckout?: string | undefined; image?: string | undefined; excludedRoots: readonly string[] }
export async function configure(options: ConfigureOptions): Promise<HostConfig> {
  if (options.image && options.image !== toolchain.verifier.image) throw new Error('verifier image is owned by the reviewed toolchain; host override is unsupported');
  if (!options.excludedRoots.length || options.excludedRoots.some(path => !path || path.includes('\0'))) throw new Error('configure requires at least one reviewed --exclude PATH');
  const requested = options.excludedRoots.map(path => resolve(path));
  const path = join(stateRoot(), 'settings.json');
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 });
  const release = await executionLock(stateRoot(), 'configuring').catch(() => { throw new Error('host configuration is locked; inspect configuring/owner.json and confirm the owner has stopped before manual recovery'); });
  try {
    let existing: HostConfig | undefined;
    try { existing = await hostConfig(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const verifierCheckout = options.verifierCheckout ? resolve(options.verifierCheckout) : undefined;
    let config: HostConfig;
    if (existing) {
      if ((options.controlRemote && options.controlRemote !== existing.controlRemote) || (verifierCheckout && verifierCheckout !== existing.verifierCheckout)) throw new Error('configure cannot change an existing host control remote or verifier checkout');
      config = { ...existing, excludedRoots: [...new Set([...(existing.excludedRoots ?? []), ...requested])] };
    } else {
      if (!options.controlRemote || !verifierCheckout) throw new Error('initial configure requires --control-remote URL and --verifier-checkout PATH');
      config = { schemaVersion: 1, host: randomUUID(), controlRemote: options.controlRemote, verifierCheckout, excludedRoots: [...new Set(requested)], billingConfirmed: false };
    }
    HostSchema.parse(config); await atomicJson(path, config); return config;
  } finally { await release(); }
}
export function binaries(root: string) {
  return { codex: join(root, 'tools/node_modules/.bin/codex'), claude: join(root, 'bin/claude'), openspec: join(root, 'tools/node_modules/.bin/openspec') };
}
export interface Readiness { version: string; host?: string; capability: 'bounded-cli-v1'; prerequisitesReady: boolean; fullWorkflowReady: boolean; crossHostHandoff: false; checks: {name:string;ok:boolean;detail:string}[]; operations: string }
export async function doctor(root: string): Promise<Readiness> {
  const bins = binaries(root); const pins = JSON.parse(await readFile(join(root, 'toolchain.json'), 'utf8'));
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  checks.push({ name: 'node', ok: process.version === 'v' + pins.node, detail: process.version });
  for (const key of ['codex', 'claude', 'openspec'] as const) {
    try { const r = await command(bins[key], ['--version']); checks.push({ name: key, ok: r.code === 0 && matchesVersion(r.stdout, pins[key]), detail: r.stdout.trim() || 'unavailable' }); }
    catch { checks.push({ name: key, ok: false, detail: 'not installed in this release' }); }
  }
  try { const auth = await authentication(bins.codex, bins.claude); for (const [name, ok] of Object.entries(auth)) checks.push({ name: `${name}-subscription`, ok, detail: ok ? 'subscription authenticated' : 'subscription not verified from this environment' }); }
  catch (e) { checks.push({ name: 'subscription-policy', ok: false, detail: (e as Error).message }); }
  try { const r = await command('docker', docker(['info', '--format', '{{.ServerVersion}}'])); checks.push({ name: 'verifier-vm', ok: r.code === 0, detail: r.code === 0 ? r.stdout.trim() : 'dedicated Colima VM unavailable' }); }
  catch { checks.push({ name: 'verifier-vm', ok: false, detail: 'Docker unavailable' }); }
  let host: HostConfig | undefined;
  try { host = await hostConfig(); checks.push({ name: 'host-config', ok: true, detail: 'configured' }); }
  catch { checks.push({ name: 'host-config', ok: false, detail: 'run aegean configure' }); }
  checks.push({ name: 'host-exclusions', ok: Boolean(host?.excludedRoots?.length), detail: host?.excludedRoots?.length ? 'reviewed host path policy configured' : 'review excludedRoots before enrolling a repository' });
  checks.push({ name: 'subscription-overflow', ok: host?.billingConfirmed === true, detail: host?.billingConfirmed ? 'operator confirmed paid overflow is disabled' : 'operator must confirm paid overflow is disabled before model execution' });
  let prerequisitesPassed = false; let prerequisiteDetail = 'configure this host before qualification';
  if (host) {
    try { await acceptedPrerequisites(root, stateRoot(), host.host); prerequisitesPassed = true; prerequisiteDetail = 'native containment and protected verifier qualified for this host/release'; }
    catch (error) { prerequisiteDetail = `${(error as Error).message.slice(0, 160)}; run aegean qualify, then aegean doctor --require prerequisites`; }
  }
  checks.push({ name: 'pilot-prerequisites', ok: prerequisitesPassed, detail: prerequisiteDetail });
  const prerequisitesReady = checks.every(check => check.ok);
  let accepted = false; let acceptanceDetail = 'bootstrap: full workflow not accepted';
  try {
    await acceptedRelease(root, stateRoot(), undefined, host?.host); accepted = true;
  } catch (error) { acceptanceDetail += (error as NodeJS.ErrnoException).code === 'ENOENT' ? '; this host has no acceptance record. An authorised pilot does not need one' : `; ${(error as Error).message.slice(0, 160)}`; }
  checks.push({ name: 'release-acceptance', ok: accepted, detail: accepted ? 'release-specific gates accepted' : acceptanceDetail });
  return { version: packageInfo.version, ...(host ? {host:host.host} : {}), capability:'bounded-cli-v1', prerequisitesReady, crossHostHandoff:false, fullWorkflowReady: checks.every(c => c.ok), checks, operations: join(root, 'docs/OPERATIONS.md') };
}
export async function acceptRelease(root: string, path: string): Promise<unknown> {
  const gate = await acceptedRelease(root, stateRoot(), await readJson(path), (await hostConfig()).host);
  await atomicJson(join(stateRoot(),'acceptance.json'),gate);
  return { accepted: true, sourceCommit: gate.sourceCommit, sourceHash: gate.sourceHash, buildHash: gate.buildHash, artifactHash: gate.artifactHash, nodeHash: gate.nodeHash };
}
export async function prepareState(): Promise<void> { await mkdir(join(stateRoot(), 'runs'), { recursive: true, mode: 0o700 }); }
