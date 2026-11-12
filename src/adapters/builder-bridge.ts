import { createServer, connect, type Socket } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Readable } from 'node:stream';
import type { Result } from './process.js';

const frameLimit = 1_048_576;
const outputLimit = 128_000;
const requestTimeoutMs = 20_000; // BuilderSession's command deadline is shorter.
const internalArgument = '--aegean-builder-stdio';
const maxArgs = 64;
const maxText = 8192;
type ObjectValue = Record<string, unknown>;
type Invocation = { args: string[]; input: string };
type BridgeReply = { ok: true; result: Result } | { ok: false; error: string };

function object(value: unknown): value is ObjectValue { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invocation(value: unknown): value is Invocation {
  return object(value) && Object.keys(value).length === 2 && Array.isArray(value.args)
    && value.args.length >= 1 && value.args.length <= maxArgs
    && value.args.every(arg => typeof arg === 'string' && arg.length >= 1 && arg.length <= maxText && !arg.includes('\0'))
    && !value.args[0].startsWith('-') && typeof value.input === 'string' && value.input.length <= maxText;
}
function validResult(value: unknown): value is Result {
  return object(value) && Object.keys(value).every(key => ['code', 'stdout', 'stderr', 'durationMs', 'interrupted', 'termination'].includes(key))
    && Number.isSafeInteger(value.code) && typeof value.stdout === 'string' && typeof value.stderr === 'string'
    && Buffer.byteLength(value.stdout) + Buffer.byteLength(value.stderr) <= outputLimit
    && typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0 && typeof value.interrupted === 'boolean'
    && (value.termination === undefined || ['aborted', 'timeout', 'output-limit', 'descendant-survived'].includes(String(value.termination)));
}

/** Bounded line framing, including clients that never send a newline. */
function frames(stream: Readable, onFrame: (value: unknown) => void, onInvalid: (oversized: boolean) => void): void {
  let pending = Buffer.alloc(0); let failed = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  stream.on('data', (chunk: Buffer) => {
    if (failed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const fragment = chunk.subarray(offset, end);
      if (pending.length + fragment.length > frameLimit) { failed = true; pending = Buffer.alloc(0); onInvalid(true); return; }
      pending = pending.length ? Buffer.concat([pending, fragment]) : Buffer.from(fragment);
      if (newline < 0) return;
      const line = pending; pending = Buffer.alloc(0); offset = newline + 1;
      let parsed: unknown;
      try { parsed = JSON.parse(decoder.decode(line)); } catch { onInvalid(false); continue; }
      onFrame(parsed);
    }
  });
  stream.on('end', () => { if (!failed && pending.length) onInvalid(false); });
}

/**
 * Coordinator-owned endpoint. close() closes transport only: the owner must
 * separately await/abort BuilderSession before claiming writers have stopped.
 */
export async function startBuilderBridge(execute: (input: unknown) => Promise<Result>): Promise<{ command: string; args: string[]; close: () => Promise<void> }> {
  // Darwin's Unix socket path limit makes the usual long TMPDIR unsuitable.
  const directory = await mkdtemp(`${process.platform === 'darwin' ? '/private/tmp' : '/tmp'}/aegean-bridge-`);
  await chmod(directory, 0o700);
  const socketPath = join(directory, 'rpc.sock');
  const sockets = new Set<Socket>();
  let closed = false; let busy = false; let uncertain = false; let closing: Promise<void> | undefined;
  const server = createServer(socket => {
    if (closed || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket); let received = false; let ownsExecution = false;
    const reply = (value: BridgeReply) => {
      if (socket.destroyed || socket.writableEnded) return;
      const encoded = JSON.stringify(value) + '\n';
      if (Buffer.byteLength(encoded) > frameLimit) { socket.destroy(); return; }
      socket.end(encoded);
    };
    const timer = setTimeout(() => { if (ownsExecution) uncertain = true; reply({ ok: false, error: 'Builder bridge request timed out; recovery required' }); socket.destroySoon(); }, requestTimeoutMs);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { if (ownsExecution) uncertain = true; clearTimeout(timer); sockets.delete(socket); });
    frames(socket, value => {
      if (received) { reply({ ok: false, error: 'Only one command per connection is allowed' }); socket.destroySoon(); return; }
      received = true;
      if (!invocation(value)) { reply({ ok: false, error: 'Invalid Builder invocation' }); return; }
      if (closed || uncertain) { reply({ ok: false, error: 'Builder bridge is closed or requires recovery' }); return; }
      if (busy) { reply({ ok: false, error: 'Builder command already active' }); return; }
      busy = true; ownsExecution = true;
      void (async () => {
        try {
          const result = await execute(value);
          reply(validResult(result) ? { ok: true, result } : { ok: false, error: 'Builder returned an invalid or oversized result' });
        } catch { reply({ ok: false, error: 'Builder execution failed; inspect coordinator diagnostics' }); }
        finally { busy = false; ownsExecution = false; }
      })();
    }, () => { reply({ ok: false, error: 'Invalid or oversized Builder bridge frame' }); socket.destroySoon(); });
  });
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolveListen(); });
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    closed = true; await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true }); throw error;
  }
  return {
    command: process.execPath,
    args: [fileURLToPath(import.meta.url), internalArgument, socketPath],
    close: async () => {
      closing ??= (async () => {
        closed = true;
        const stopped = new Promise<void>(resolveClose => server.close(() => resolveClose()));
        for (const socket of sockets) socket.destroy();
        await stopped; await rm(directory, { recursive: true, force: true });
      })();
      await closing;
    },
  };
}

function forward(socketPath: string, input: Invocation, connections: Set<Socket>): Promise<BridgeReply> {
  return new Promise(resolveReply => {
    const socket = connect(socketPath); connections.add(socket); let settled = false;
    const finish = (value: BridgeReply) => {
      if (settled) return; settled = true; clearTimeout(timer); connections.delete(socket); socket.destroy(); resolveReply(value);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'Builder bridge request timed out; recovery required' }), requestTimeoutMs + 1000);
    socket.on('connect', () => socket.write(JSON.stringify(input) + '\n'));
    socket.on('error', () => finish({ ok: false, error: 'Builder bridge is unavailable' }));
    socket.on('close', () => finish({ ok: false, error: 'Builder bridge disconnected; recovery required' }));
    frames(socket, value => {
      if (!object(value) || typeof value.ok !== 'boolean') { finish({ ok: false, error: 'Invalid Builder bridge response' }); return; }
      if (value.ok && validResult(value.result)) finish({ ok: true, result: value.result });
      else if (!value.ok && typeof value.error === 'string' && value.error.length <= 200) finish({ ok: false, error: value.error });
      else finish({ ok: false, error: 'Invalid Builder bridge response' });
    }, () => finish({ ok: false, error: 'Invalid or oversized Builder bridge response' }));
  });
}

function stdio(socketPath: string): void {
  const connections = new Set<Socket>(); let busy = false; let stopped = false; let requests = 0;
  const stop = () => {
    if (stopped) return; stopped = true; process.exitCode = 1;
    for (const socket of connections) socket.destroy();
    process.stdin.destroy();
  };
  const send = (value: unknown) => {
    if (stopped) return;
    const encoded = JSON.stringify(value) + '\n'; const size = Buffer.byteLength(encoded);
    if (size > frameLimit || process.stdout.writableLength + size > frameLimit) { stop(); return; }
    process.stdout.write(encoded);
  };
  const error = (id: unknown, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.on('error', stop); process.stdin.on('error', stop);
  frames(process.stdin, request => {
    if (stopped) return;
    if (++requests > 10_000) { stop(); return; }
    const id = object(request) && (typeof request.id === 'string' && request.id.length <= 200 || typeof request.id === 'number' && Number.isSafeInteger(request.id)) ? request.id : null;
    if (!object(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || request.method.length > 80 || Object.keys(request).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key))) { error(id, -32600, 'Invalid request'); return; }
    if (request.id === undefined) return; // Notifications never launch commands.
    if (id === null) { error(null, -32600, 'Invalid request id'); return; }
    const respond = (result: unknown) => send({ jsonrpc: '2.0', id, result });
    if (request.method === 'initialize') {
      respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'aegean-builder', version: '1' } }); return;
    }
    if (request.method === 'ping') { respond({}); return; }
    if (request.method === 'tools/list') {
      respond({ tools: [{ name: 'execute', description: 'Run argv with stdin inside the bounded candidate VM. No host execution or caller-selected VM settings.', inputSchema: { type: 'object', properties: { args: { type: 'array', minItems: 1, maxItems: maxArgs, items: { type: 'string', minLength: 1, maxLength: maxText } }, input: { type: 'string', maxLength: maxText } }, required: ['args', 'input'], additionalProperties: false } }] }); return;
    }
    if (request.method !== 'tools/call') { error(id, -32601, 'Method not found'); return; }
    if (!object(request.params) || Object.keys(request.params).some(key => !['name', 'arguments'].includes(key)) || request.params.name !== 'execute' || !invocation(request.params.arguments)) { error(id, -32602, 'Invalid execute tool arguments'); return; }
    if (busy) { error(id, -32000, 'Builder command already active'); return; }
    busy = true;
    void forward(socketPath, request.params.arguments, connections).then(result => {
      if (result.ok) respond({ content: [{ type: 'text', text: JSON.stringify(result.result) }] });
      else error(id, -32000, result.error);
    }).finally(() => { busy = false; });
  }, oversized => { if (oversized) stop(); else error(null, -32700, 'Parse error'); });
}

// Importing this adapter never starts stdin processing or a socket server.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const socketPath = process.argv[3];
  if (process.argv.length !== 4 || process.argv[2] !== internalArgument || !socketPath || !/^\/(?:private\/)?tmp\/aegean-bridge-[A-Za-z0-9]+\/rpc\.sock$/.test(socketPath)) {
    process.stderr.write('Builder bridge requires its coordinator-created internal endpoint\n'); process.exitCode = 1;
  } else stdio(socketPath);
}
