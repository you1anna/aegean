import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { confirmHumanDecision, assertDecision } from '../src/adapters/human-decision.js';

const actor = { id: 123, login: 'operator' };
function terminal(answer: string, tty = true) {
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  const output = Object.assign(new PassThrough(), { isTTY: tty });
  let text = ''; output.on('data', chunk => { text += chunk.toString(); if (text.includes('to cancel: ')) setImmediate(() => input.write(answer + '\n')); });
  return { input, output };
}
test('local human decisions reject unattended input, wrong text and changed account', async () => {
  await assert.rejects(confirmHumanDecision('publish', 'run-12345678', 'Review', {}, actor, async () => actor, undefined, terminal('publish 12345678', false)), /interactive terminal/);
  await assert.rejects(confirmHumanDecision('publish', 'run-12345678', 'Review', {}, actor, async () => actor, undefined, terminal('yes')), /cancelled/);
  let count = 0;
  await assert.rejects(confirmHumanDecision('publish', 'run-12345678', 'Review', {}, actor, async () => ++count === 1 ? actor : { id: 999, login: 'other' }, undefined, terminal('publish 12345678')), /account changed/);
});
test('human decision binds exact artifacts and account across readable login rename', async () => {
  const artifact = { commit: 'a'.repeat(40), spec: 'b'.repeat(64) };
  const decision = await confirmHumanDecision('publish', 'run-12345678', 'Exact candidate review', artifact, actor, async () => ({ ...actor, login: 'renamed' }), undefined, terminal('publish 12345678'));
  assertDecision(decision, 'publish', 'run-12345678', artifact, actor);
  assert.throws(() => assertDecision(decision, 'publish', 'run-12345678', { ...artifact, commit: 'c'.repeat(40) }, actor), /stale/);
  assert.throws(() => assertDecision(decision, 'publish', 'run-12345678', artifact, { ...actor, id: 999 }), /stale/);
  assert.throws(() => assertDecision(decision, 'approve', 'run-12345678', artifact, actor), /stale/);
});
