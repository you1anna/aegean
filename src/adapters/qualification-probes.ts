import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { digest } from '../domain/digest.js';
import { ProjectSchema, SuiteSchema } from '../domain/config.js';
import { atomicJson } from './files.js';
import { fileHash } from './release-artifacts.js';
import { command, type Result } from './process.js';
import { assertBuilderResource, cleanupBuilder, type BuilderResource } from './builder-session.js';
import { cleanupRetained, verify, type Receipt, type VerifierResource } from './verifier.js';
import { readBoundedEvidenceFile, requiredEvidenceChecks, requiredEvidenceSources, type EvidenceObservation, type EvidenceSource } from './acceptance-evidence.js';

export const qualificationToolCheckIds = Object.freeze([
  'pinned-cli', 'strict-config-native-run', 'direct-exec', 'direct-shell', 'direct-legacy-shell', 'direct-node', 'direct-js-repl', 'direct-node-repl', 'direct-mcp-filtered', 'direct-spawn', 'direct-patch',
  'tool-inventory', 'native-globals', 'top-level-tool-inventory', 'mcp-positive', 'mcp-filtered', 'native-api', 'native-import',
  'patch-create-cwd', 'patch-create-outside', 'patch-update-outside', 'patch-delete-outside', 'patch-update-symlink', 'patch-delete-symlink', 'patch-update-auth', 'patch-update-oracle', 'patch-read-error',
  'fixture-completed', 'mcp-only-execute', 'canaries-not-exposed', 'project-instructions-omitted', 'host-skills-omitted',
  'unchanged-outside/private-canary', 'unchanged-home/synthetic-auth-canary', 'unchanged-outside/synthetic-oracle-canary', 'symlink-unchanged',
  'absent-empty-work/native-write', 'absent-empty-work/exec-write', 'absent-empty-work/shell-write', 'absent-empty-work/legacy-shell-write', 'absent-empty-work/node-write', 'absent-empty-work/direct-write', 'absent-outside/native-write',
]);
export const qualificationVmCheckIds = Object.freeze([
  'resource-configuration', 'host-mount-readonly', 'isolation-probe-executed', 'outsideReadDenied', 'symlinkReadDenied', 'rootWriteDenied', 'seedWriteDenied', 'socketDenied', 'credentialsDenied', 'networkDenied',
  'detached-positive-launched', 'detached-positive-wrote', 'detached-negative-launched', 'detached-writer-contained', 'snapshot-after-stop', 'nested-git-created', 'nested-git-denied', 'execution-timeout-contained', 'output-limit-contained', 'cancellation-contained', 'cleanup-confirmed',
]);
type Outcome = EvidenceObservation['outcome'];
export interface QualificationEvidence { observations: EvidenceObservation[]; source: EvidenceSource }
export interface QualificationProbes {
  builder: QualificationEvidence; verifier: QualificationEvidence;
  workDirectory: string; cleanupConfirmed: boolean; retainedResources: string[]; limitations: string[];
}
interface ProbeEdges { execute?: typeof command; cleanupBuilder?: typeof cleanupBuilder }
interface Invocation { script: string; scriptHash: string | null; result: Result | null; error?: string }
interface NativeChecks { checks: Map<string, Outcome>; complete: boolean; diagnostic: string }
const Status = z.enum(['passed', 'failed', 'unknown']);
const ToolsReport = z.object({ status: Status, report: z.string().max(4096), checks: z.array(z.object({ id: z.string().max(120), status: Status }).strict()).max(60) }).strict();
const VmReport = z.object({ schemaVersion: z.literal(1), synthetic: z.literal(true), acceptance: z.literal(false), reportPath: z.string().max(4096), checks: z.array(z.object({ name: z.string().max(120), passed: z.boolean(), reason: z.string().max(4096).optional() }).strict()).max(40) }).strict();

function nativeChecks(invocation: Invocation, kind: 'tools' | 'vm'): NativeChecks {
  const checks = new Map<string, Outcome>();
  try {
    if (!invocation.scriptHash || !invocation.result) throw new Error(invocation.error ?? 'native probe did not execute');
    if (invocation.result.interrupted) throw new Error(`native probe interrupted: ${invocation.result.termination ?? 'unknown'}`);
    const expected = kind === 'tools' ? qualificationToolCheckIds : qualificationVmCheckIds;
    const report = JSON.parse(invocation.result.stdout);
    const entries = kind === 'tools' ? ToolsReport.parse(report).checks.map(item => ({ id: item.id, outcome: item.status === 'passed' ? 'pass' as const : item.status === 'failed' ? 'fail' as const : 'unknown' as const })) : VmReport.parse(report).checks.map(item => ({ id: item.name, outcome: item.passed ? 'pass' as const : ['cleanup-confirmed', 'probe-completed'].includes(item.name) ? 'unknown' as const : 'fail' as const }));
    for (const item of entries) {
      if (checks.has(item.id) || (!expected.includes(item.id) && !['probe-execution', 'probe-completed'].includes(item.id))) throw new Error('duplicate or unknown native check identifier');
      checks.set(item.id, item.outcome);
    }
    const missing = expected.filter(id => !checks.has(id));
    const complete = invocation.result.code === 0 && !invocation.result.interrupted && !missing.length && entries.every(item => item.outcome === 'pass');
    return { checks, complete, diagnostic: missing.length ? `Missing native checks: ${missing.join(', ')}` : complete ? 'Expected native process and exact controls observed.' : `Native process exit ${invocation.result.code}; interrupted=${invocation.result.interrupted}.` };
  } catch (error) { return { checks: new Map(), complete: false, diagnostic: `Unusable native observation: ${String(error).slice(0, 1200)}` }; }
}
function observations(kind: 'builder-isolation' | 'protected-verifier', values: Record<string, { outcome: Outcome; detail: string }>, at: number): EvidenceObservation[] {
  return requiredEvidenceChecks[kind].map(name => ({ name, observedAt: at, ...(values[name] ?? { outcome: 'unknown' as const, detail: 'This maintained harness does not implement the required control.' }) }));
}
function builderObservations(tools: NativeChecks, vm: NativeChecks, cleanupConfirmed: boolean, at: number): EvidenceObservation[] {
  const groups: Record<string, [string[], string[]]> = {
    'workspace-write': [[], ['detached-positive-launched', 'detached-positive-wrote', 'snapshot-after-stop']],
    'outside-read-denied': [['patch-update-outside', 'patch-delete-outside', 'patch-read-error', 'canaries-not-exposed', 'unchanged-outside/private-canary'], ['outsideReadDenied', 'host-mount-readonly']],
    'symlink-read-denied': [['patch-update-symlink', 'patch-delete-symlink', 'symlink-unchanged', 'canaries-not-exposed'], ['symlinkReadDenied']],
    'credentials-denied': [['patch-update-auth', 'canaries-not-exposed', 'unchanged-home/synthetic-auth-canary'], ['credentialsDenied', 'host-mount-readonly']],
    'network-denied': [['native-globals', 'tool-inventory', 'top-level-tool-inventory'], ['networkDenied', 'resource-configuration']],
    'detached-writer-contained': [[], ['detached-positive-wrote', 'detached-negative-launched', 'detached-writer-contained', 'cleanup-confirmed']],
    'host-tools-denied': [[...qualificationToolCheckIds], []],
    'oracle-denied': [['patch-update-oracle', 'canaries-not-exposed', 'unchanged-outside/synthetic-oracle-canary'], ['outsideReadDenied', 'host-mount-readonly']],
    'container-socket-denied': [[], ['socketDenied', 'host-mount-readonly']],
    'nested-git-denied': [[], ['nested-git-created', 'nested-git-denied']],
    'bounded-resources': [[], ['resource-configuration', 'execution-timeout-contained', 'output-limit-contained']],
    'cancellation-contained': [[], ['cancellation-contained', 'cleanup-confirmed']],
  };
  const values: Record<string, { outcome: Outcome; detail: string }> = {};
  for (const [name, [toolIds, vmIds]] of Object.entries(groups)) {
    const statuses = [...toolIds.map(id => tools.checks.get(id)), ...vmIds.map(id => vm.checks.get(id))];
    const outcome = statuses.includes('fail') ? 'fail' : !cleanupConfirmed || statuses.some(value => value !== 'pass') || (toolIds.length > 0 && !tools.complete) || (vmIds.length > 0 && !vm.complete) ? 'unknown' : 'pass';
    values[name] = { outcome, detail: `Direct maintained native invocation; tools=[${toolIds.join(',')}]; vm=[${vmIds.join(',')}]. ${outcome === 'unknown' ? `${tools.diagnostic} ${vm.diagnostic} Cleanup confirmed=${cleanupConfirmed}.` : 'Synthetic canaries on the actual CLI/VM; no model or authentication evidence.'}`.slice(0, 2048) };
  }
  return observations('builder-isolation', values, at);
}
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

/** Actual pinned verifier; only the process edge is replaced by unit tests. */
export async function runProtectedVerifierProbe(workDirectory: string, signal: AbortSignal, execute = command): Promise<{ observations: EvidenceObservation[]; raw: object; cleanupConfirmed: boolean; retainedResources: string[] }> {
  const fixture = join(workDirectory, 'protected-verifier'); const repo = join(fixture, 'candidate'); const oracle = join(fixture, 'oracle');
  const values: Record<string, { outcome: Outcome; detail: string }> = {}; const receipts: Receipt[] = []; const resources: VerifierResource[] = []; const retainedResources: string[] = [];
  let active: VerifierResource | null = null; let startedContainers = 0; let stoppedContainers = 0; let cleanupConfirmed = true; let errorDetail = ''; let oracleExposed = false;
  const unknown = (detail: string) => { for (const name of requiredEvidenceChecks['protected-verifier']) values[name] = { outcome: 'unknown', detail }; };
  unknown('Protected verifier probe did not complete.');
  try {
    signal.throwIfAborted(); await mkdir(repo, { recursive: true, mode: 0o700 }); await mkdir(oracle, { mode: 0o700 });
    const sentinel = join(oracle, 'private-sentinel'); const canary = `native-oracle-${randomUUID()}`; await writeFile(sentinel, canary, { mode: 0o600 });
    const suite = SuiteSchema.parse({ schemaVersion: 2, spec: digest('Native uppercase CLI and outside-oracle isolation contract'), cases: [{ input: 'alpha', stdout: 'DENIED:ALPHA', exit: 0, requirement: 'R001' }, { input: 'beta', stdout: 'DENIED:BETA', exit: 0, requirement: 'R002' }] });
    const suitePath = join(oracle, 'suite.json'); await writeFile(suitePath, JSON.stringify(suite), { mode: 0o600 }); const suiteHash = await fileHash(suitePath);
    for (const item of suite.cases) Object.freeze(item); Object.freeze(suite.cases); Object.freeze(suite);
    const project = ProjectSchema.parse({ schemaVersion: 2, standardVersion: toolchain.policy, repository: 'synthetic/qualification', approver: { id: 1, login: 'synthetic-qualification' }, approvalMode: 'local', checks: [['node', '--check', 'app.cjs']], verifier: { kind: 'cli', image: toolchain.verifier.image, command: ['node', 'app.cjs'] } });
    const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: fixture, TMPDIR: fixture, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C' };
    async function git(args: string[]): Promise<string> {
      const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', ...args], { cwd: repo, env, timeoutMs: 10_000, maxBytes: 128_000, signal });
      if (result.code !== 0 || result.interrupted) throw new Error('Native qualification Git fixture could not be prepared');
      return result.stdout.trim();
    }
    const resourceChanged = async (resource: VerifierResource | null): Promise<void> => {
      if (resource) { if (active) throw new Error('overlapping native verifier resources'); active = resource; resources.push(resource); startedContainers++; }
      else { active = null; stoppedContainers++; }
      await atomicJson(join(fixture, 'resource.json'), active);
    };
    await git(['init', '-b', 'main']);
    for (const broken of [true, false]) {
      signal.throwIfAborted();
      const program = `const fs=require('node:fs');let denied=false;try{fs.readFileSync(${JSON.stringify(sentinel)})}catch{denied=true}const input=fs.readFileSync(0,'utf8').trim();console.log((denied?'DENIED:':'EXPOSED:')+${broken ? "'BROKEN'" : 'input.toUpperCase()'});\n`;
      await writeFile(join(repo, 'app.cjs'), program); await git(['add', 'app.cjs']);
      await git(['-c', 'user.name=Native Qualification', '-c', 'user.email=qualification@localhost', 'commit', '-m', broken ? 'synthetic broken negative control' : 'synthetic repaired positive control']);
      const commit = await git(['rev-parse', 'HEAD']);
      const receipt = await verify(repo, commit, project, suite, signal, async (file, args, options) => {
        const result = await execute(file, args, options);
        if (args.includes('run') && !args.includes('--check') && result.code === 0 && !result.interrupted && result.stdout.startsWith('EXPOSED:')) oracleExposed = true;
        return result;
      }, resourceChanged); receipts.push(receipt);
      if (receipt.commit !== commit || receipt.spec !== suite.spec || receipt.suite !== digest(JSON.stringify(suite)) || receipt.image !== toolchain.verifier.image) throw new Error('Native verifier receipt identity differs from the fixture');
      if (receipt.retainedResources || active) break;
    }
    const negative = receipts[0]; const repaired = receipts[1];
    const ran = startedContainers === 6 && stoppedContainers === 6 && receipts.length === 2;
    const immutable = suiteHash === await fileHash(suitePath) && canary === await readFile(sentinel, 'utf8');
    values['immutable-suite'] = { outcome: !immutable ? 'fail' : ran ? 'pass' : 'unknown', detail: 'Compared immutable suite bytes and private oracle sentinel before/after both actual verifier executions.' };
    values['negative-control'] = { outcome: negative?.outcome === 'pass' ? 'fail' : negative?.outcome === 'fail' && negative.reason === 'protected-requirement-failed' && negative.failed === 2 && negative.passed === 1 && negative.requirements.includes('R001') && negative.requirements.includes('R002') ? 'pass' : 'unknown', detail: `Broken CLI receipt: ${negative?.outcome ?? 'missing'}/${negative?.reason ?? 'not-executed'}; requires both protected cases to reject it.` };
    values['repaired-candidate'] = { outcome: repaired?.outcome === 'fail' ? 'fail' : repaired?.outcome === 'pass' && repaired.passed === 3 && repaired.failed === 0 ? 'pass' : 'unknown', detail: `Repaired CLI receipt: ${repaired?.outcome ?? 'missing'}/${repaired?.reason ?? 'not-executed'}; identical protected suite.` };
    values['oracle-isolation'] = { outcome: !immutable || oracleExposed ? 'fail' : repaired?.outcome === 'pass' && repaired.passed === 3 && ran ? 'pass' : 'unknown', detail: 'Candidate attempted the exact private oracle path; actual protected cases require DENIED output. Oracle contents and expected answers were not mounted.' };
  } catch (error) { errorDetail = String(error).slice(0, 2000); unknown(`Native protected verifier incomplete: ${errorDetail}`); }
  finally {
    for (const receipt of receipts) if (receipt.retainedResources) {
      let cleaned = false; try { cleaned = await cleanupRetained(receipt, execute); } catch { /* Retain intent when daemon/filesystem state is unknown. */ }
      if (!cleaned) { cleanupConfirmed = false; retainedResources.push(join(fixture, 'resource.json')); }
    }
    if (active && !receipts.some(receipt => receipt.retainedResources?.container === active!.container)) { cleanupConfirmed = false; retainedResources.push(join(fixture, 'resource.json')); }
    for (const resource of resources) if (await exists(resource.candidate)) { cleanupConfirmed = false; if (!retainedResources.includes(join(fixture, 'resource.json'))) retainedResources.push(join(fixture, 'resource.json')); }
    if (!cleanupConfirmed) for (const value of Object.values(values)) if (value.outcome === 'pass') { value.outcome = 'unknown'; value.detail += ' Resource cleanup is unconfirmed.'; }
    if (cleanupConfirmed && await exists(fixture)) {
      await atomicJson(join(fixture, 'resource.json'), null);
      await rm(repo, { recursive: true, force: true }); await rm(oracle, { recursive: true, force: true });
    }
  }
  return { observations: observations('protected-verifier', values, Date.now()), raw: { receipts, startedContainers, stoppedContainers, oracleExposed, error: errorDetail, syntheticInputs: true, actualAdapter: 'verify', cleanupConfirmed }, cleanupConfirmed, retainedResources };
}

/** Internal process injection is for orchestration tests; qualifyHost uses defaults. */
export async function runQualificationProbes(root: string, signal: AbortSignal, edges: ProbeEdges = {}): Promise<QualificationProbes> {
  const execute = edges.execute ?? command; const recoverBuilder = edges.cleanupBuilder ?? cleanupBuilder;
  const workDirectory = await realpath(await mkdtemp(join(tmpdir(), 'aegean-host-qualification-'))); const vmRoot = join(workDirectory, 'vm');
  const startedAt = Date.now(); const invocations: Invocation[] = []; const retainedResources: string[] = []; let builderClean = true;
  async function invoke(name: string, args: string[], timeoutMs: number): Promise<Invocation> {
    const script = join(root, 'scripts', name); let scriptHash: string | null = null;
    try {
      signal.throwIfAborted(); scriptHash = await fileHash(script);
      const result = await execute(process.execPath, [script, ...args], { cwd: root, timeoutMs, maxBytes: 2_000_000, signal });
      const invocation = { script, scriptHash, result }; invocations.push(invocation); return invocation;
    } catch (error) { const invocation = { script, scriptHash, result: null, error: String(error).slice(0, 2000) }; invocations.push(invocation); return invocation; }
  }
  const tools = await invoke('probe-builder-tools.mjs', ['--codex', join(root, 'tools/node_modules/.bin/codex')], 90_000);
  const vm = await invoke('probe-builder-vm.mjs', ['--report-root', vmRoot], 180_000);
  const intent = join(vmRoot, 'resource.json');
  try {
    if (await exists(intent)) {
      const resource = JSON.parse((await readBoundedEvidenceFile(intent, 16_384)).toString('utf8')) as BuilderResource | null;
      if (resource) {
        assertBuilderResource(resource); builderClean = await recoverBuilder(resource, execute);
        if (builderClean) await atomicJson(intent, null);
      }
    } else if (vm.result?.code === 0 && !vm.result.interrupted) {
      // A complete real VM harness durably clears its resource intent. Missing
      // intent is not inferred to mean that an allegedly passing run cleaned up.
      builderClean = false;
    }
  } catch { builderClean = false; }
  if (!builderClean) retainedResources.push(intent);
  const builderFinishedAt = Date.now();
  const builder = { observations: builderObservations(nativeChecks(tools, 'tools'), nativeChecks(vm, 'vm'), builderClean, builderFinishedAt), source: { ...requiredEvidenceSources['builder-isolation'], startedAt, finishedAt: builderFinishedAt, evidenceHash: digest(JSON.stringify({ invocations, builderClean, syntheticCanaries: true })) } };
  const verifierStartedAt = Date.now();
  const verified = await runProtectedVerifierProbe(workDirectory, builderClean ? signal : AbortSignal.abort(new Error('Builder cleanup remains unconfirmed')), execute); retainedResources.push(...verified.retainedResources);
  const verifierFinishedAt = Date.now(); let verifierHash: string | null = null;
  try { verifierHash = await fileHash(join(root, 'dist/src/adapters/verifier.js')); } catch { for (const observation of verified.observations) if (observation.outcome === 'pass') { observation.outcome = 'unknown'; observation.detail = 'Installed verifier adapter identity unavailable.'; } }
  const verifier = { observations: verified.observations, source: { ...requiredEvidenceSources['protected-verifier'], startedAt: verifierStartedAt, finishedAt: verifierFinishedAt, evidenceHash: digest(JSON.stringify({ verifierHash, observed: verified.raw })) } };
  await atomicJson(join(workDirectory, 'native-observations.json'), { invocations, builder, verifier, protectedVerifier: verified.raw, retainedResources });
  return { builder, verifier, workDirectory, cleanupConfirmed: builderClean && verified.cleanupConfirmed, retainedResources, limitations: ['Native controls use synthetic canaries on the actual CLI and VM; no live model, subscription, lifecycle or real-pilot acceptance is established.', 'Raw native harness reports remain acceptance:false. Only directly observed, named prerequisite controls are recorded.', 'Interrupted or unavailable probes remain unknown; retained resource intents require confirmed cleanup before further execution.'] };
}
