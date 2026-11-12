import { lstat, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { command, type Result } from './process.js';
import { docker, removeContainer, removeVolume } from './container-runtime.js';
import { captureProgram, parseSnapshot, type BuilderSnapshot } from './builder-snapshot.js';
import toolchain from '../../toolchain.json' with { type: 'json' };

export interface BuilderResource {
  schemaVersion: 1; id: string; writer: string; collector: string;
  volume: string; seed: string; image: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function builderResource(id: string, root = toolchain.verifier.candidateRoot): BuilderResource {
  if (!uuid.test(id) || /[,\0\r\n]/.test(root)) throw new Error('invalid Builder resource identity');
  const name = `aegean-builder-${id}`;
  return { schemaVersion: 1, id, writer: name, collector: `${name}-capture`, volume: `${name}-data`, seed: join(resolve(root), `builder-${id}`, 'seed'), image: toolchain.verifier.image };
}
export function assertBuilderResource(value: BuilderResource, root = toolchain.verifier.candidateRoot): void {
  const expected = builderResource(value?.id ?? '', root);
  if (Object.keys(value).length !== Object.keys(expected).length || Object.entries(expected).some(([k, v]) => value[k as keyof BuilderResource] !== v)) throw new Error('invalid Builder resource identity');
}

const idle = 'setInterval(()=>{},1000)';
const seedAndIdle = 'const fs=require("node:fs"),path=require("node:path");if(fs.readdirSync("/candidate").length)throw new Error("Builder volume is not empty");for(const name of fs.readdirSync("/seed"))fs.cpSync(path.join("/seed",name),path.join("/candidate",name),{recursive:true,force:false,errorOnExist:true});fs.writeFileSync("/tmp/aegean-ready","ready");' + idle;
export function builderContainerArgs(resource: BuilderResource, role: 'writer' | 'collector'): string[] {
  const writer = role === 'writer';
  return ['run', '--detach', '--name', writer ? resource.writer : resource.collector,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user=65534:65534', '--pids-limit=64', '--memory=512m', '--cpus=1',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=32m', '--mount', `type=volume,src=${resource.volume},dst=/candidate,volume-nocopy${writer ? '' : ',readonly'}`,
    ...(writer ? ['--mount', `type=bind,src=${resource.seed},dst=/seed,readonly`] : []),
    '--workdir=/candidate', '--entrypoint=node', resource.image, '-e', writer ? seedAndIdle : idle];
}

export async function cleanupBuilder(resource: BuilderResource, execute = command, root = toolchain.verifier.candidateRoot): Promise<boolean> {
  assertBuilderResource(resource, root);
  // Keep the collector mounted while writer state is unknown, preserving both
  // the bounded workspace and the evidence needed for explicit recovery.
  if (!await removeContainer(resource.writer, execute)) return false;
  if (!await removeContainer(resource.collector, execute)) return false;
  if (!await removeVolume(resource.volume, execute)) return false;
  await rm(dirname(resource.seed), { recursive: true, force: true });
  return true;
}

const Invocation = z.object({
  args: z.array(z.string().min(1).max(8192).refine(s => !s.includes('\0'))).min(1).max(64).refine(args => !args[0]!.startsWith('-'), 'command must not be an option'),
  input: z.string().max(8192).default(''),
}).strict();

/** One coordinator-owned writer. Candidate commands can choose argv/stdin only. */
export class BuilderSession {
  private started = false;
  private closed = false;
  private failed = false;
  private cleaned = false;
  private pending: Promise<Result> | undefined;
  private readonly controller = new AbortController();
  constructor(
    readonly resource: BuilderResource,
    private readonly resourceChanged: (resource: BuilderResource | null) => Promise<void>,
    private readonly run = command,
    private readonly root = toolchain.verifier.candidateRoot,
    private readonly signal?: AbortSignal,
  ) { assertBuilderResource(resource, root); }

  private combinedSignal(): AbortSignal {
    return this.signal ? AbortSignal.any([this.signal, this.controller.signal]) : this.controller.signal;
  }
  private async checked(args: string[], maxBytes = 128_000): Promise<Result> {
    const result = await this.run('docker', docker(args), { timeoutMs: 15_000, maxBytes, signal: this.combinedSignal() });
    if (result.code !== 0 || result.interrupted) throw new Error('Builder container operation failed or interrupted');
    return result;
  }
  async start(): Promise<void> {
    if (this.started || this.closed) throw new Error('Builder session already started or closed');
    const seed = await lstat(this.resource.seed);
    if (!seed.isDirectory() || seed.isSymbolicLink()) throw new Error('invalid Builder seed directory');
    // This callback is durable before any Docker side effect, including an
    // uncertain create response. It is cleared only after confirmed cleanup.
    await this.resourceChanged(this.resource);
    this.started = true;
    try {
      await this.checked(['image', 'inspect', this.resource.image]);
      await this.checked(['volume', 'create', '--driver=local', '--opt=type=tmpfs', '--opt=device=tmpfs', '--opt=o=size=128m,uid=65534,gid=65534,mode=0700', this.resource.volume]);
      await this.checked(builderContainerArgs(this.resource, 'collector'));
      await this.checked(builderContainerArgs(this.resource, 'writer'));
      const deadline = Date.now() + 15_000;
      for (;;) {
        const ready = await this.run('docker', docker(['exec', this.resource.writer, 'node', '-e', 'process.exit(require("node:fs").existsSync("/tmp/aegean-ready")?0:75)']), { timeoutMs: 1000, maxBytes: 8192, signal: this.combinedSignal() });
        if (ready.code === 0 && !ready.interrupted) break;
        if (ready.interrupted || ready.code !== 75 || Date.now() >= deadline) throw new Error('Builder workspace initialization failed');
        await delay(50, undefined, { signal: this.combinedSignal() });
      }
    } catch (error) {
      // Initialization is fixed trusted code; retain its bounded diagnostic
      // before cleanup removes the container. Never use logs as success proof.
      let detail = '';
      try { const logs = await this.run('docker', docker(['logs', '--tail', '20', this.resource.writer]), { timeoutMs: 3000, maxBytes: 8192 }); detail = (logs.stderr || logs.stdout).slice(0, 2000); } catch { /* unavailable */ }
      await this.abort(); throw new Error(`${String(error)}${detail ? `: ${detail}` : ''}`);
    }
  }

  async execute(input: unknown): Promise<Result> {
    if (!this.started || this.closed || this.failed) throw new Error('Builder session is closed or failed');
    if (this.pending) throw new Error('Builder command already active');
    const invocation = Invocation.parse(input);
    const pending = this.run('docker', docker(['exec', '-i', '--workdir=/candidate', '--', this.resource.writer, ...invocation.args]), { input: invocation.input, timeoutMs: 15_000, maxBytes: 128_000, signal: this.combinedSignal() });
    this.pending = pending;
    try {
      const result = await pending;
      if (result.interrupted) { this.failed = true; this.controller.abort(); }
      return result;
    } catch (error) { this.failed = true; this.controller.abort(); throw error; }
    finally { this.pending = undefined; }
  }

  private async cleanup(): Promise<void> {
    if (this.cleaned) return;
    if (!await cleanupBuilder(this.resource, this.run, this.root)) throw new Error('Builder cleanup or writer termination is unknown; retain ownership and recover');
    await this.resourceChanged(null);
    this.cleaned = true;
  }

  async finish(): Promise<BuilderSnapshot> {
    if (!this.started || this.closed) throw new Error('Builder session is closed');
    this.closed = true;
    try {
      if (this.pending) await this.pending;
      if (this.failed || this.signal?.aborted) throw new Error('Builder session failed or interrupted');
      if (!await removeContainer(this.resource.writer, this.run)) throw new Error('Builder writer termination is unknown');
      // The only process reading candidate files now is a fixed trusted program
      // in a separate read-only container. Detached candidate processes are gone.
      const captured = await this.checked(['exec', this.resource.collector, 'node', '-e', captureProgram], 145_000_000);
      return parseSnapshot(JSON.parse(captured.stdout));
    } finally { await this.cleanup(); }
  }

  async abort(): Promise<void> {
    this.closed = true; this.controller.abort();
    try { await this.pending; } catch { /* cleanup remains required */ }
    if (this.started) await this.cleanup();
  }
}
