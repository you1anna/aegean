import { mkdir, writeFile, rm, mkdtemp, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checked, command } from './process.js';
import { digest } from '../domain/workflow.js';
import type { Suite, Project } from '../domain/config.js';
import toolchain from '../../toolchain.json' with { type: 'json' };
export interface Receipt {
  schemaVersion: 1; commit: string; spec: string; suite: string; image: string;
  outcome: 'pass' | 'fail' | 'inconclusive'; passed: number; failed: number;
  feedback: string[]; durationMs: number;
}
export const docker = (args: string[]): string[] => ['--context', `colima-${toolchain.verifier.profile}`, ...args];
export async function exportCommit(repo: string, commit: string, target: string): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid candidate SHA');
  const listing = await checked('git', ['ls-tree', '-rz', '--full-tree', commit], { cwd: repo, maxBytes: 4_000_000 });
  let bytes = 0; let files = 0;
  for (const item of listing.split('\0').filter(Boolean)) {
    const candidateName = item.slice(item.indexOf('\t') + 1);
    if (['.agents/', '.claude/', '.codex/'].some(prefix => candidateName.startsWith(prefix))) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(item);
    if (!match) throw new Error('candidate includes symlinks, submodules or unsupported file types');
    const [, mode, object, name] = match as unknown as [string, string, string, string];
    if (name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.git' || p === '.env' || p.startsWith('.env.') || p === '.npmrc' || p === '.aws' || p === '.ssh')) throw new Error('unsafe candidate path');
    const result = await promisify(execFile)('git', ['cat-file', 'blob', object], { cwd: repo, encoding: 'buffer', maxBuffer: 5_000_000, timeout: 10_000 });
    bytes += result.stdout.length; if (++files > 10000 || bytes > 100_000_000) throw new Error('candidate exceeds capacity limit');
    const path = join(target, name); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, result.stdout, { mode: mode === '100755' ? 0o755 : 0o644, flag: 'wx' });
  }
}
export function containerArgs(name: string, candidate: string, image: string, args: string[]): string[] {
  if (candidate.includes(',') || !/^[\w./:-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('invalid container input');
  return ['run', '--rm', '-i', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=64', '--memory=512m', '--cpus=1', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m', '--mount', `type=bind,src=${candidate},dst=/candidate,readonly`, '--workdir=/candidate', '--entrypoint', args[0]!, image, ...args.slice(1)];
}
export async function verify(repo: string, commit: string, project: Project, suite: Suite, signal?: AbortSignal): Promise<Receipt> {
  const started = Date.now();
  const shared = toolchain.verifier.candidateRoot; await mkdir(shared, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(shared, 'candidate-')); await chmod(dir, 0o755);
  const receipt: Receipt = { schemaVersion: 1, commit, spec: suite.spec, suite: digest(JSON.stringify(suite)), image: project.verifier.image, outcome: 'pass', passed: 0, failed: 0, feedback: [], durationMs: 0 };
  try {
    await checked('docker', docker(['image', 'inspect', project.verifier.image]));
    await exportCommit(repo, commit, dir);
    const cases = [ ...project.checks.map(args => ({ args, input: '', stdout: undefined, exit: 0, feedback: 'Public check failed' })), ...suite.cases.map(c => ({ ...c, args: project.verifier.command })) ];
    for (const c of cases) {
      if (signal?.aborted) throw new Error('verification cancelled');
      const name = `aegean-${randomUUID()}`;
      try {
        const r = await command('docker', docker(containerArgs(name, dir, project.verifier.image, c.args)), { input: c.input, timeoutMs: 15_000, maxBytes: 128_000, ...(signal ? { signal } : {}) });
        if (r.code === 125 || r.interrupted) { receipt.outcome = 'inconclusive'; receipt.feedback.push('Verifier infrastructure error or execution limit'); break; }
        if (r.code === c.exit && (c.stdout === undefined || r.stdout.trimEnd() === c.stdout.trimEnd())) receipt.passed++;
        else { receipt.failed++; receipt.feedback.push(c.feedback); receipt.outcome = 'fail'; }
      } finally { await command('docker', docker(['rm', '--force', name]), { timeoutMs: 10_000 }); }
    }
  } catch { receipt.outcome = 'inconclusive'; receipt.feedback = ['Verifier could not complete; inspect operator diagnostics']; }
  finally { await rm(dir, { recursive: true, force: true }); }
  receipt.durationMs = Date.now() - started;
  return receipt;
}
