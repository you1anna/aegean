import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedContext, promptRecord, toolOutputAllowance } from '../src/domain/context.js';
import { claudeArgs } from '../src/adapters/agents.js';
import { checked } from '../src/adapters/process.js';
import { POLICY } from '../src/domain/workflow-policy.js';
import { digest, identity } from '../src/domain/digest.js';
import { unknownTask } from '../src/domain/model-policy.js';
import { sourceContext } from '../src/application/model-context.js';

// Recorded context manifests are run evidence. The literal values below came from the source before the refactor.
test('bounded context keeps its exact framing, order, manifest hashes and scope', () => {
  const context = boundedContext([{ path: 'b.ts', text: 'two', required: false }, { path: 'a "q".md', text: 'one', required: false }, { path: 'z.md', text: 'req', required: true }], 1000);
  assert.equal(context.text, '\nFILE "z.md"\nreq\n\nFILE "a \\"q\\".md"\none\n\nFILE "b.ts"\ntwo\n');
  assert.equal(JSON.stringify(context.manifest), JSON.stringify([
    { path: 'z.md', hash: '4364c1243297f7ed9b91cd24dbd4d77e45d08824d5e0228f9821c71b30b5cc34', bytes: 3, required: true, included: true },
    { path: 'a "q".md', hash: '49e9fcfb5617aad332d56d58ffd0c7020d29ec1d0d0a03b7d7c47f268820acf3', bytes: 3, required: false, included: true },
    { path: 'b.ts', hash: 'b85d38dc71a8027700bebd3c30d39424852cf532883d88f0a0d992d3bf0eba9b', bytes: 3, required: false, included: true },
  ]));
  // A manifest hash identifies the JSON text of the part, not the raw part text.
  assert.equal(context.manifest[0]!.hash, digest(JSON.stringify('req')));
  assert.notEqual(context.manifest[0]!.hash, digest('req'));
  assert.deepEqual(Object.keys(context), ['text', 'manifest', 'bytes', 'tokenEstimate', 'scope']);
  assert.equal(context.bytes, 57);
  assert.equal(context.scope, 'Aegean-supplied text only; CLI system text and tool schemas excluded');
});
test('source context reserves exactly the bytes that the bounded context frames', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'aegean-source-context-')));
  try {
    const git = (args: string[]) => checked('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false', ...args], { cwd: repo });
    // The optional file sorts before the required one by path alone, so the required-first order is visible.
    await git(['init', '-b', 'main']);
    await writeFile(join(repo, 'README.md'), 'readme'); await writeFile(join(repo, 'a.ts'), 'alpha');
    await git(['add', '.']); await git(['commit', '-m', 'synthetic']);
    const required = '\nFILE "README.md"\nreadme\n', framed = required + '\nFILE "a.ts"\nalpha\n';
    const exact = await sourceContext(repo, unknownTask, Buffer.byteLength(framed));
    assert.equal(exact.text, framed); assert.deepEqual(exact.omitted, []);
    assert.deepEqual(exact.manifest.map(part => [part.path, part.required, part.included]), [['README.md', true, true], ['a.ts', false, true]]);
    // One byte less: the size check omits the optional file before the bounded context sees it.
    const short = await sourceContext(repo, unknownTask, Buffer.byteLength(framed) - 1);
    assert.equal(short.text, required); assert.deepEqual(short.omitted, ['a.ts']);
    assert.deepEqual(short.manifest.map(part => part.path), ['README.md']);
    assert.deepEqual(short.sourceObjects.map(object => object.path), ['README.md', 'a.ts']);
    await assert.rejects(sourceContext(repo, unknownTask, Buffer.byteLength(required) - 1), /required context exceeds \d+ bytes: README\.md/);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('required context has priority, counts Unicode bytes and never silently truncates', () => {
  const input = [{ path: 'optional', text: 'x'.repeat(100), required: false }, { path: 'required', text: '海', required: true }];
  const a = boundedContext(input, 40), b = boundedContext([...input].reverse(), 40);
  assert.deepEqual(a, b); assert.equal(a.manifest[0]!.bytes, 3);
  assert.equal(a.manifest[1]!.included, false); assert.equal(a.tokenEstimate, null);
  assert.throws(() => boundedContext(input, 1), /required context exceeds/);
  assert.throws(() => boundedContext([input[1]!, input[1]!], 100), /duplicate/);
});
test('cumulative tool output stops repeated reads and withholds an oversized response', () => {
  const budget = toolOutputAllowance(6); budget.consume('海'); budget.consume('海');
  assert.equal(budget.status().used, 6);
  assert.throws(() => budget.consume('a'), /complete result withheld/);
  assert.throws(() => budget.check(), /limit reached/);
  assert.equal(budget.status().used, 6);
});
test('Claude arguments pin model and effort without weakening subscription isolation', () => {
  const profile = POLICY.models.roles.scout.baseline, args = claudeArgs(profile);
  assert.equal(args[args.indexOf('--model') + 1], profile.model);
  assert.equal(args[args.indexOf('--effort') + 1], profile.effort);
  for (const control of ['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(control));
  assert.ok(!args.includes('--fallback-model')); assert.ok(!args.includes('--bare'));
});
test('a prompt record hashes the prompt text, and a JSON identity sorts keys and leaves out undefined', () => {
  const prompt = 'p海';
  assert.equal(JSON.stringify(promptRecord('builder', prompt)), JSON.stringify({ role: 'builder', bytes: 4, hash: digest(prompt), tokenEstimate: null, scope: 'Aegean prompt only; CLI system text and tool schemas excluded' }));
  assert.notEqual(promptRecord('builder', prompt).hash, identity(prompt));
  assert.equal(identity({ b: 1, a: undefined, c: [{ y: 2, x: 1 }] }), digest('{"b":1,"c":[{"x":1,"y":2}]}'));
  assert.equal(identity(undefined), digest('undefined'));
});
