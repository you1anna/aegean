import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
export interface Result { code: number; stdout: string; stderr: string; durationMs: number; interrupted: boolean; termination?: 'aborted' | 'timeout' | 'output-limit' | 'descendant-survived' }
export interface Options { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }
export async function command(file: string, args: readonly string[], options: Options = {}): Promise<Result> {
  const started = Date.now(); const limit = options.maxBytes ?? 1024 * 1024;
  if (options.signal?.aborted) return { code: 128, stdout: '', stderr: '', durationMs: 0, interrupted: true, termination: 'aborted' };
  return await new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { cwd: options.cwd, env: options.env ?? process.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let bytes = 0; let interrupted = false; let killTimer: NodeJS.Timeout | undefined;
    const outDecoder = new StringDecoder('utf8'); const errDecoder = new StringDecoder('utf8');
    let termination: Result['termination']; let closed: number | undefined; let groupStopped = false;
    const finish = () => {
      if (closed === undefined || (interrupted && !groupStopped)) return;
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      resolve({ code: closed, stdout, stderr, durationMs: Date.now() - started, interrupted, ...(termination ? { termination } : {}) });
    };
    const stop = (reason: NonNullable<Result['termination']>) => {
      if (interrupted) return; interrupted = true; termination = reason;
      const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch { /* already exited */ } };
      kill('SIGTERM');
      // Keep the escalation alive even if the immediate child closes its pipes.
      // Its descendants may still be running and ignoring TERM.
      killTimer = setTimeout(() => { kill('SIGKILL'); groupStopped = true; finish(); }, 750);
    };
    const abort = () => stop('aborted');
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs ?? 30_000); timer.unref();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const collect = (kind: 'out' | 'err', chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) { stop('output-limit'); return; }
      if (kind === 'out') stdout += outDecoder.write(chunk); else stderr += errDecoder.write(chunk);
    };
    child.stdout.on('data', b => collect('out', b)); child.stderr.on('data', b => collect('err', b));
    child.stdin.on('error', () => undefined); child.stdin.end(options.input);
    child.on('error', e => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort); reject(e); });
    child.on('close', code => {
      stdout += outDecoder.end(); stderr += errDecoder.end();
      closed = code ?? 128;
      if (!interrupted && child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 0); stop('descendant-survived'); } catch { /* no remaining group */ }
      }
      finish();
    });
  });
}
export async function checked(file: string, args: readonly string[], options: Options = {}): Promise<string> {
  const result = await command(file, args, options);
  if (result.code !== 0 || result.interrupted) throw new Error(`${file} failed (${result.interrupted ? 'interrupted' : result.code}): ${result.stderr.slice(0, 2000)}`);
  return result.stdout.trim();
}
