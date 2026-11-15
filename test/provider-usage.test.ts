import test from 'node:test';
import assert from 'node:assert/strict';
import { providerUsage } from '../src/adapters/usage.js';
test('Claude totals include cache creation and reads once, ignoring intermediate events', () => {
  const final = { type: 'result', model: 'claude-sonnet-5', usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 5 } };
  const usage = providerUsage(JSON.stringify({ type: 'message', usage: { input_tokens: 99 } }) + '\n' + JSON.stringify(final), 'claude');
  assert.equal(usage.total, 37); assert.equal(usage.input, 32); assert.equal(usage.cachedInput, 20);
  assert.equal(usage.model, 'claude-sonnet-5');
  assert.equal(providerUsage(JSON.stringify({ ...final, usage: { input_tokens: 2, output_tokens: 5 } }), 'claude').total, null);
});
test('Codex adds distinct completed turns and deduplicates identified events without double counting reasoning or caches', () => {
  const a = { type: 'turn.completed', id: 'a', usage: { input_tokens: 10, cached_input_tokens: 8, output_tokens: 5, reasoning_output_tokens: 3 } };
  const b = { ...a, id: 'b' };
  assert.equal(providerUsage([a, a, b].map(x => JSON.stringify(x)).join('\n'), 'codex').total, 30);
  assert.equal(providerUsage(JSON.stringify({ ...a, usage: { ...a.usage, cached_input_tokens: 11 } }), 'codex').total, null);
  assert.equal(providerUsage(JSON.stringify(a) + '\n' + JSON.stringify({ ...a, usage: { ...a.usage, output_tokens: 6 } }), 'codex').total, null);
  const anonymous = { ...a, id: undefined };
  assert.equal(providerUsage([anonymous, anonymous].map(x => JSON.stringify(x)).join('\n'), 'codex').total, null);
});
test('malformed, unsafe, missing or interrupted usage never becomes zero', () => {
  for (const text of ['null', '[]', 'not JSON', '{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":2}}', '{"type":"turn.completed","usage":{"input_tokens":9007199254740991,"output_tokens":2}}']) {
    assert.equal(providerUsage(text, 'codex').total, null);
  }
});

test('an earlier completed Codex turn cannot settle a later incomplete or failed turn', () => {
  const done = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
  for (const type of ['turn.started', 'turn.failed', 'error']) assert.equal(providerUsage(done + '\n' + JSON.stringify({ type }), 'codex').total, null);
});
