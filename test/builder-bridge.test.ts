import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { connect } from 'node:net';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import { startBuilderBridge } from '../src/adapters/builder-bridge.js';
import type { Result } from '../src/adapters/process.js';

const ok = (stdout = ''): Result => ({ code: 0, stdout, stderr: '', durationMs: 1, interrupted: false });
interface Reply { id: number | null; result?: { content?: { text: string }[]; tools?: { name: string }[]; protocolVersion?: string }; error?: { code: number; message: string } }

function client(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const replies = new Map<number | null, Reply>();
  const waiting = new Map<number | null, { resolve: (value: Reply) => void; reject: (error: Error) => void }>();
  let buffered = ''; let stderr = '';
  child.stdin.on('error', () => {});
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffered += data;
    for (;;) {
      const end = buffered.indexOf('\n'); if (end < 0) break;
      const reply = JSON.parse(buffered.slice(0, end)) as Reply; buffered = buffered.slice(end + 1);
      const pending = waiting.get(reply.id);
      if (pending) { waiting.delete(reply.id); pending.resolve(reply); } else replies.set(reply.id, reply);
    }
  });
  child.on('close', () => { for (const pending of waiting.values()) pending.reject(new Error(`bridge child exited: ${stderr}`)); waiting.clear(); });
  return {
    child,
    send: (value: unknown) => { child.stdin.write(JSON.stringify(value) + '\n'); },
    receive: async (id: number | null): Promise<Reply> => {
      const ready = replies.get(id); if (ready) { replies.delete(id); return ready; }
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`bridge response timed out: ${stderr}`)); }, 5000);
        waiting.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      });
    },
  };
}
async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
}
const call = (id: number, arguments_: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'execute', arguments: arguments_ } });

test('trusted stdio bridge exposes only execute and forwards argv/stdin through a private socket', async () => {
  const seen: unknown[] = [];
  const bridge = await startBuilderBridge(async input => { seen.push(input); return ok('a\u0000b'); });
  const peer = client(bridge.command, bridge.args);
  try {
    const socket = bridge.args.at(-1)!;
    assert.equal((await stat(dirname(socket))).mode & 0o777, 0o700);
    assert.equal((await stat(socket)).mode & 0o777, 0o600);
    peer.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } });
    assert.equal((await peer.receive(1)).result?.protocolVersion, '2024-11-05');
    peer.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    peer.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'execute', arguments: { args: ['forbidden-notification'], input: '' } } });
    peer.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual((await peer.receive(2)).result?.tools?.map(tool => tool.name), ['execute']);
    peer.send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.deepEqual((await peer.receive(3)).result, {});
    const invocation = { args: ['node', '-e', 'console.log(42)'], input: 'synthetic' };
    peer.send(call(4, invocation));
    assert.deepEqual(JSON.parse((await peer.receive(4)).result!.content![0]!.text), ok('a\u0000b'));
    assert.deepEqual(seen, [invocation]);
  } finally { await stop(peer.child); await bridge.close(); }
});

test('importing the bridge has no stdio entrypoint side effect and direct invocation requires internal arguments', async () => {
  const module = new URL('../src/adapters/builder-bridge.js', import.meta.url);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(module.href)}); process.stdout.write('imported')`], { timeout: 5000, encoding: 'utf8' });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, 'imported');
  const direct = spawnSync(process.execPath, [module.pathname], { timeout: 5000, encoding: 'utf8' });
  assert.equal(direct.status, 1); assert.equal(direct.stdout, '');
  assert.match(direct.stderr, /internal endpoint/);
});

test('bridge rejects malformed envelopes, unknown methods/tools, and oversized or extended inputs', async () => {
  let calls = 0; const bridge = await startBuilderBridge(async () => { calls++; return ok(); });
  const peer = client(bridge.command, bridge.args);
  try {
    peer.child.stdin.write('{broken\n');
    assert.equal((await peer.receive(null)).error?.code, -32700);
    peer.send({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    assert.equal((await peer.receive(1)).error?.code, -32601);
    peer.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'shell', arguments: {} } });
    assert.equal((await peer.receive(2)).error?.code, -32602);
    const bad = [{ args: ['node'], input: '', cwd: '/private' }, { args: ['node'], input: 'x'.repeat(8193) }, { args: ['node\0'], input: '' }, { args: [] }, { args: ['--privileged'], input: '' }];
    for (const [index, input] of bad.entries()) {
      peer.send(call(index + 3, input));
      assert.equal((await peer.receive(index + 3)).error?.code, -32602);
    }
    assert.equal(calls, 0);
    peer.child.stdin.write('x'.repeat(1_048_577));
    await once(peer.child, 'close');
    assert.notEqual(peer.child.exitCode, 0);
  } finally { await stop(peer.child); await bridge.close(); }
});

test('bridge rejects overlapping commands across children without queuing execution', async () => {
  let release!: () => void; let entered!: () => void; let calls = 0;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const bridge = await startBuilderBridge(async () => { calls++; entered(); await held; return ok('done'); });
  const first = client(bridge.command, bridge.args); const second = client(bridge.command, bridge.args);
  try {
    first.send(call(1, { args: ['node'], input: '' })); await active;
    first.send(call(3, { args: ['node'], input: '' }));
    assert.match((await first.receive(3)).error?.message ?? '', /active/);
    second.send(call(2, { args: ['node'], input: '' }));
    assert.match((await second.receive(2)).error?.message ?? '', /active/);
    assert.equal(calls, 1); release();
    assert.ok((await first.receive(1)).result);
  } finally { release(); await Promise.all([stop(first.child), stop(second.child)]); await bridge.close(); }
});

test('private socket validates inputs independently of the stdio frontend', async () => {
  let calls = 0; const bridge = await startBuilderBridge(async () => { calls++; return ok(); });
  try {
    for (const payload of ['{broken\n', JSON.stringify({ args: ['node'], input: '', socket: '/another' }) + '\n', 'x'.repeat(1_048_577)]) {
      const socket = connect(bridge.args.at(-1)!);
      try {
        const response = once(socket, 'data'); socket.write(payload);
        const [data] = await response;
        assert.equal(JSON.parse(data.toString()).ok, false);
      } finally { socket.destroy(); }
    }
    assert.equal(calls, 0);
  } finally { await bridge.close(); }
});

test('bridge bounds callback output and never exposes callback exception details', async () => {
  let calls = 0;
  const bridge = await startBuilderBridge(async () => {
    calls++; if (calls === 1) throw new Error('synthetic-private-host-path');
    return ok('\u0000'.repeat(128_001));
  });
  const peer = client(bridge.command, bridge.args);
  try {
    peer.send(call(1, { args: ['node'], input: '' }));
    const error = await peer.receive(1);
    assert.ok(error.error); assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
    peer.send(call(2, { args: ['node'], input: '' }));
    assert.ok((await peer.receive(2)).error);
  } finally { await stop(peer.child); await bridge.close(); }
});

test('maximum bounded output remains valid after both JSON escaping layers', async () => {
  const bridge = await startBuilderBridge(async () => ok('\u0000'.repeat(128_000)));
  const peer = client(bridge.command, bridge.args);
  try {
    peer.send(call(1, { args: ['node'], input: '' }));
    const response = await peer.receive(1);
    assert.equal(JSON.parse(response.result!.content![0]!.text).stdout.length, 128_000);
  } finally { await stop(peer.child); await bridge.close(); }
});

test('disconnect during an active command requires recovery even after its callback settles', async () => {
  let release!: () => void; let entered!: () => void; let calls = 0;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const bridge = await startBuilderBridge(async () => { calls++; entered(); await held; return ok(); });
  const raw = connect(bridge.args.at(-1)!); const peer = client(bridge.command, bridge.args);
  try {
    raw.write(JSON.stringify({ args: ['node'], input: '' }) + '\n'); await active;
    const disconnected = once(raw, 'close'); raw.destroy(); await disconnected;
    // Observe the server's disconnect before releasing the callback; a local
    // close event alone does not establish that its peer processed the close.
    let recoveryObserved = false;
    for (let id = 1; id <= 20; id++) {
      peer.send(call(id, { args: ['node'], input: '' }));
      const error = (await peer.receive(id)).error?.message ?? '';
      if (/recovery/.test(error)) { recoveryObserved = true; break; }
      assert.match(error, /active/);
    }
    assert.equal(recoveryObserved, true); release();
    peer.send(call(21, { args: ['node'], input: '' }));
    assert.match((await peer.receive(21)).error?.message ?? '', /recovery/);
    assert.equal(calls, 1);
  } finally { raw.destroy(); release(); await stop(peer.child); await bridge.close(); }
});

test('bridge deadline rejects a stalled callback and fences subsequent execution', { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: () => void; let entered!: () => void; let calls = 0;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const bridge = await startBuilderBridge(async () => { calls++; entered(); await held; return ok(); });
  const peer = client(bridge.command, bridge.args);
  try {
    peer.send(call(1, { args: ['node'], input: '' })); await active;
    t.mock.timers.tick(20_000);
    assert.match((await peer.receive(1)).error?.message ?? '', /timed out/);
    release(); peer.send(call(2, { args: ['node'], input: '' }));
    assert.match((await peer.receive(2)).error?.message ?? '', /recovery/);
    assert.equal(calls, 1);
  } finally { release(); await stop(peer.child); await bridge.close(); t.mock.timers.reset(); }
});

test('close gates new requests, disconnects pending clients, and removes only its private directory', async () => {
  let release!: () => void; let entered!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const bridge = await startBuilderBridge(async () => { entered(); await held; return ok(); });
  const peer = client(bridge.command, bridge.args);
  try {
    peer.send(call(1, { args: ['node'], input: '' })); await active;
    await bridge.close(); await bridge.close();
    assert.ok((await peer.receive(1)).error);
    await assert.rejects(stat(dirname(bridge.args.at(-1)!)), { code: 'ENOENT' });
    const socket = connect(bridge.args.at(-1)!); await once(socket, 'error'); socket.destroy();
  } finally { release(); await stop(peer.child); await bridge.close(); }
});
