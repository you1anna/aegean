import { spawn } from 'node:child_process';
export interface Result { code: number; stdout: string; stderr: string; durationMs: number; interrupted: boolean }
export interface Options { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }
export async function command(file: string, args: readonly string[], options: Options = {}): Promise<Result> {
  const started = Date.now(); const limit = options.maxBytes ?? 1024 * 1024;
  return await new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { cwd: options.cwd, env: options.env ?? process.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let bytes = 0; let interrupted = false; let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (interrupted) return; interrupted = true;
      const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch { /* already exited */ } };
      kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 750); killTimer.unref();
    };
    const timer = setTimeout(stop, options.timeoutMs ?? 30_000); timer.unref();
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
    const collect = (kind: 'out' | 'err', chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) { stop(); return; }
      if (kind === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', b => collect('out', b)); child.stderr.on('data', b => collect('err', b));
    child.stdin.on('error', () => undefined); child.stdin.end(options.input);
    child.on('error', e => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener('abort', stop); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); options.signal?.removeEventListener('abort', stop); resolve({ code: code ?? 128, stdout, stderr, durationMs: Date.now() - started, interrupted }); });
  });
}
export async function checked(file: string, args: readonly string[], options: Options = {}): Promise<string> {
  const result = await command(file, args, options);
  if (result.code !== 0 || result.interrupted) throw new Error(`${file} failed (${result.interrupted ? 'interrupted' : result.code}): ${result.stderr.slice(0, 2000)}`);
  return result.stdout.trim();
}
