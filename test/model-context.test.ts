import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedContext, toolOutputAllowance } from '../src/domain/context.js';
import { claudeArgs } from '../src/adapters/agents.js';
import { POLICY } from '../src/domain/workflow-policy.js';

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
