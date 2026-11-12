import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuilderSession, builderResource, cleanupBuilder, builderContainerArgs } from '../src/adapters/builder-session.js';
import type { Result } from '../src/adapters/process.js';
import toolchain from '../toolchain.json' with { type: 'json' };

const ok = (stdout = ''): Result => ({ code: 0, stdout, stderr: '', durationMs: 1, interrupted: false });
const id = '00000000-0000-4000-8000-000000000001';
const snapshot = JSON.stringify({ schemaVersion: 1, files: [{ path: 'answer.js', mode: 420, data: 'NDI=' }] });

test('Builder capture follows writer termination; bounded VM workspace has no writable host mount', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegean-builder-'));
  const resource = builderResource(id, root);
  const calls: string[][] = []; const intents: unknown[] = [];
  const execute = async (_file: string, args: readonly string[]) => {
    calls.push([...args]);
    return ok(args.includes('exec') && args.includes(resource.collector) ? snapshot : 'ready');
  };
  try {
    await mkdir(resource.seed, { recursive: true });
    const session = new BuilderSession(resource, async value => { intents.push(value); }, execute, root);
    await session.start();
    await assert.rejects(session.execute({ args: ['--privileged', 'node'], input: '' }), /command must not be an option/);
    await session.execute({ args: ['node', '-e', 'console.log(42)'], input: '' });
    const result = await session.finish();
    assert.equal(result.files[0]?.path, 'answer.js');
    assert.deepEqual(intents, [resource, null]);
    const stopped = calls.findIndex(args => args.includes('rm') && args.includes(resource.writer));
    const captured = calls.findIndex(args => args.includes('exec') && args.includes(resource.collector));
    assert.ok(stopped >= 0 && captured > stopped);
    const args = builderContainerArgs(resource, 'writer');
    assert.ok(args.includes('--network=none') && args.includes('--read-only') && args.includes('--user=65534:65534'));
    assert.ok(args.filter(arg => arg.startsWith('type=bind')).every(arg => arg.endsWith(',readonly')));
    assert.ok(calls.some(args => args.includes('--opt=o=size=128m,uid=65534,gid=65534,mode=0700')));
    const command = calls.find(args => args.includes('console.log(42)'))!;
    assert.equal(command[command.indexOf(resource.writer) - 1], '--');
    await assert.rejects(session.execute({ args: ['node'], input: '' }), /closed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unknown writer termination blocks capture and retains intent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegean-builder-'));
  const resource = builderResource(id, root); const calls: string[][] = []; const intents: unknown[] = [];
  const execute = async (_file: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args.includes('rm') || args.includes('ls')) return { ...ok(), code: 1 };
    return ok('ready');
  };
  try {
    await mkdir(resource.seed, { recursive: true });
    const session = new BuilderSession(resource, async value => { intents.push(value); }, execute, root);
    await session.start();
    await assert.rejects(session.finish(), /cleanup|termination/);
    assert.equal(intents.length, 1);
    assert.ok(!calls.some(args => args.includes('exec') && args.includes(resource.collector)));
    assert.equal(await cleanupBuilder(resource, execute, root), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Builder command timeout poisons session and concurrent commands cannot overlap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aegean-builder-')); const resource = builderResource(id, root);
  let unblock!: () => void; let started!: () => void;
  const active = new Promise<void>(r => { started = r; }); const pending = new Promise<void>(r => { unblock = r; });
  const execute = async (_file: string, args: readonly string[]) => {
    if (args.includes('untrusted-command')) { started(); await pending; return { ...ok(), interrupted: true, termination: 'timeout' as const }; }
    return ok('ready');
  };
  try {
    await mkdir(resource.seed, { recursive: true });
    const session = new BuilderSession(resource, async () => {}, execute, root); await session.start();
    const first = session.execute({ args: ['untrusted-command'], input: '' }); await active;
    await assert.rejects(session.execute({ args: ['node'], input: '' }), /active|busy/);
    unblock(); await first;
    await assert.rejects(session.execute({ args: ['node'], input: '' }), /closed|failed/);
    await assert.rejects(session.finish(), /failed|interrupted/);
  } finally { unblock?.(); await rm(root, { recursive: true, force: true }); }
});

test('cleanup rejects forged resource names, image and host paths', async () => {
  const resource = builderResource(id, '/private/tmp/fixture');
  for (const forged of [{ ...resource, writer: 'unrelated' }, { ...resource, image: 'node:latest' }, { ...resource, seed: '/Users/private' }]) {
    await assert.rejects(cleanupBuilder(forged, async () => ok(), '/private/tmp/fixture'), /resource/);
  }
  assert.equal(resource.image, toolchain.verifier.image);
});
