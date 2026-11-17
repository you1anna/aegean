import { mkdir, writeFile, rm, mkdtemp, chmod } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checked, command } from './process.js';
import { digest } from '../domain/workflow.js';
import { assertSupportedImage, type Suite, type Project } from '../domain/config.js';
import toolchain from '../../toolchain.json' with { type: 'json' };
import { docker, removeContainer } from './container-runtime.js';
export { docker } from './container-runtime.js';
export interface Receipt {
  schemaVersion: 1; commit: string; spec: string; suite: string; image: string;
  outcome: 'pass' | 'fail' | 'inconclusive' | 'cancelled'; passed: number; failed: number;
  requirements: string[]; reason: string; durationMs: number;
  /** One result for each protected case that ran, in suite order. Public checks have none. */
  caseResults: ('pass' | 'fail')[];
  /** Paths outside the approved allowed paths; only for the reason outside-allowed-paths. */
  outsidePaths?: string[];
  retainedResources?: { container: string; candidate: string };
}
export type VerifierResource = NonNullable<Receipt['retainedResources']>;
export class CandidateRejected extends Error {}
export async function cleanupRetained(receipt: Receipt, execute = command): Promise<boolean> {
  const resource = receipt.retainedResources;
  if (!resource) return true;
  if (!/^aegean-[a-f0-9-]{36}$/.test(resource.container) || dirname(resolve(resource.candidate)) !== resolve(toolchain.verifier.candidateRoot) || !/^candidate-[\w-]+$/.test(basename(resource.candidate))) throw new Error('invalid retained verifier resource identity');
  if (!await removeContainer(resource.container, execute)) return false;
  await rm(resource.candidate, { recursive: true, force: true }); return true;
}
export async function exportCommit(repo: string, commit: string, target: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid candidate SHA');
  const listed = await command('git', ['ls-tree', '-rz', '--full-tree', commit], { cwd: repo, maxBytes: 4_000_000, ...(signal ? { signal } : {}) });
  if (listed.termination === 'output-limit') throw new CandidateRejected('candidate listing exceeds capacity limit');
  if (listed.code !== 0 || listed.interrupted) throw new Error('cannot list candidate commit');
  const listing = listed.stdout;
  let bytes = 0; let files = 0;
  for (const item of listing.split('\0').filter(Boolean)) {
    signal?.throwIfAborted();
    const candidateName = item.slice(item.indexOf('\t') + 1);
    if (candidateName === '.mcp.json' || ['.agents/', '.claude/', '.codex/'].some(prefix => candidateName.startsWith(prefix))) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(item);
    if (!match) throw new CandidateRejected('candidate includes symlinks, submodules or unsupported file types');
    const [, mode, object, name] = match as unknown as [string, string, string, string];
    if (name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.git' || p === '.env' || p.startsWith('.env.') || p === '.npmrc' || p === '.aws' || p === '.ssh' || p === '.aegean-tmp')) throw new CandidateRejected('unsafe candidate path');
    const size = Number(await checked('git', ['cat-file', '-s', object], { cwd: repo, ...(signal ? { signal } : {}) }));
    if (!Number.isSafeInteger(size) || size > 5_000_000 || ++files > 10000 || bytes + size > 100_000_000) throw new CandidateRejected('candidate exceeds capacity limit');
    signal?.throwIfAborted();
    const result = await promisify(execFile)('git', ['cat-file', 'blob', object], { cwd: repo, encoding: 'buffer', maxBuffer: 5_000_001, timeout: 10_000, ...(signal ? { signal } : {}) });
    bytes += result.stdout.length;
    const path = join(target, name); await mkdir(dirname(path), { recursive: true });
    signal?.throwIfAborted();
    await writeFile(path, result.stdout, { mode: mode === '100755' ? 0o755 : 0o644, flag: 'wx' });
  }
}
export function containerArgs(name: string, candidate: string, image: string, args: string[]): string[] {
  if (candidate.includes(',') || !/^[\w./:-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('invalid container input');
  return ['run', '-i', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=64', '--memory=512m', '--cpus=1', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m', '--mount', `type=bind,src=${candidate},dst=/candidate,readonly`, '--workdir=/candidate', '--entrypoint', args[0]!, image, ...args.slice(1)];
}
export async function verify(repo: string, commit: string, project: Project, suite: Suite, signal?: AbortSignal, execute = command, resourceChanged?: (resource: VerifierResource | null) => Promise<void>): Promise<Receipt> {
  assertSupportedImage(project);
  const started = Date.now();
  const shared = toolchain.verifier.candidateRoot; await mkdir(shared, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(shared, 'candidate-')); await chmod(dir, 0o755);
  const receipt: Receipt = { schemaVersion: 1, commit, spec: suite.spec, suite: digest(JSON.stringify(suite)), image: project.verifier.image, outcome: 'pass', passed: 0, failed: 0, requirements: [], reason: 'passed', durationMs: 0, caseResults: [] };
  let retainExport = false;
  try {
    if (signal?.aborted) { receipt.outcome = 'cancelled'; receipt.reason = 'operator-cancelled'; return receipt; }
    const image = await execute('docker', docker(['image', 'inspect', project.verifier.image]), { ...(signal ? { signal } : {}) });
    signal?.throwIfAborted();
    if (image.code !== 0 || image.interrupted) { receipt.reason = 'image-unavailable'; throw new Error('verifier image unavailable'); }
    await exportCommit(repo, commit, dir, signal);
    const cases = [ ...project.checks.map(args => ({ args, input: '', stdout: undefined, exit: 0, requirement: '' })), ...suite.cases.map(c => ({ ...c, args: project.verifier.command })) ];
    for (const c of cases) {
      if (signal?.aborted) { receipt.outcome = 'cancelled'; receipt.reason = 'operator-cancelled'; break; }
      const name = `aegean-${randomUUID()}`;
      await resourceChanged?.({ container: name, candidate: dir });
      try {
        const r = await execute('docker', docker(containerArgs(name, dir, project.verifier.image, c.args)), { input: c.input, timeoutMs: 15_000, maxBytes: 128_000, ...(signal ? { signal } : {}) });
        if (r.termination === 'aborted' || signal?.aborted) { receipt.outcome = 'cancelled'; receipt.reason = 'operator-cancelled'; break; }
        if (r.interrupted) {
          const state = await execute('docker', docker(['inspect', '--format', '{{json .State}}', name]));
          let actual: { Status?: string; Running?: boolean; StartedAt?: string; FinishedAt?: string; Error?: string } = {};
          try { actual = JSON.parse(state.stdout); } catch { /* execution not established */ }
          const started = Date.parse(actual.StartedAt ?? '');
          const ran = state.code === 0 && !state.interrupted && !actual.Error && started > 0;
          const timedOut = ran && (actual.Running === true || Date.parse(actual.FinishedAt ?? '') - started >= 15000);
          const candidateLimit = (r.termination === 'timeout' && timedOut) || (r.termination === 'output-limit' && ran);
          receipt.outcome = candidateLimit ? 'fail' : 'inconclusive'; receipt.reason = candidateLimit ? r.termination === 'timeout' ? 'candidate-timeout' : 'candidate-output-limit' : 'execution-unknown';
          if (candidateLimit) { receipt.failed++; if (c.requirement) receipt.caseResults.push('fail'); }
          break;
        }
        let exit = r.code;
        if ([125, 126, 127].includes(r.code)) {
          const state = await execute('docker', docker(['inspect', '--format', '{{json .State}}', name]));
          let actual: { Status?: string; ExitCode?: number; Error?: string } = {};
          try { actual = JSON.parse(state.stdout); } catch { /* not known to have run */ }
          if (state.code !== 0 || actual.Status !== 'exited' || actual.Error || !Number.isInteger(actual.ExitCode)) { receipt.outcome = 'inconclusive'; receipt.reason = 'container-infrastructure'; break; }
          exit = actual.ExitCode!;
        }
        const passed = exit === c.exit && (c.stdout === undefined || r.stdout.trimEnd() === c.stdout.trimEnd());
        if (c.requirement) receipt.caseResults.push(passed ? 'pass' : 'fail');
        if (passed) receipt.passed++;
        else { receipt.failed++; if (c.requirement) receipt.requirements.push(c.requirement); receipt.reason = c.requirement ? 'protected-requirement-failed' : 'public-check-failed'; receipt.outcome = 'fail'; }
      } finally {
        retainExport = !await removeContainer(name, execute);
        if (retainExport) { receipt.outcome = 'inconclusive'; receipt.reason = 'container-cleanup-failed'; receipt.retainedResources = { container: name, candidate: dir }; }
        else await resourceChanged?.(null);
      }
      if (retainExport) break;
    }
  } catch (error) {
    receipt.outcome = signal?.aborted ? 'cancelled' : error instanceof CandidateRejected ? 'fail' : 'inconclusive';
    receipt.reason = signal?.aborted ? 'operator-cancelled' : error instanceof CandidateRejected ? 'candidate-rejected' : receipt.reason === 'passed' ? 'verifier-infrastructure' : receipt.reason;
    if (!signal?.aborted && error instanceof CandidateRejected) receipt.failed++;
  }
  finally { if (!retainExport) await rm(dir, { recursive: true, force: true }); receipt.durationMs = Date.now() - started; }
  return receipt;
}
