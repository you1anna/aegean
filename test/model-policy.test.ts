import test from 'node:test';
import assert from 'node:assert/strict';
import toolchain from '../toolchain.json' with { type: 'json' };
import { ModelPolicySchema, TaskScopeSchema, selectModel, qualificationIdentity, qualificationPolicyIdentity, qualifies, type Qualification } from '../src/domain/model-policy.js';
import { tokenStatus, reserveTokens, settleTokens } from '../src/domain/token-budget.js';

test('model choice is explicit and keeps unknown scope, repairs and both Auditors on the baseline', () => {
  const policy = ModelPolicySchema.parse(toolchain.models);
  const task = TaskScopeSchema.parse({ class: 'routine-cli', paths: ['app.cjs'], dependencies: [], concerns: [] });
  const profile = policy.roles.builder;
  profile.candidate = { provider: 'codex', model: 'gpt-6-luna', effort: 'medium' };
  const report: Qualification = {
    taskClass: 'routine-cli', identity: qualificationIdentity(profile, toolchain.codex, qualificationPolicyIdentity(policy, toolchain)), manifest: 'a'.repeat(64),
    pairs: Array.from({ length: 30 }, (_, n) => ({ fixture: `fixture-${Math.floor(n / 3)}`, attempt: n % 3 + 1,
      baseline: { tokens: 100, passed: true, missedRequirements: 0, acceptedDefects: 0 },
      candidate: { tokens: 70, passed: true, missedRequirements: 0, acceptedDefects: 0 } })),
  };
  profile.qualification = report;
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(policy, toolchain)), true);
  assert.equal(selectModel(policy, 'builder', task, 0, toolchain).model, 'gpt-6-luna');
  assert.equal(selectModel(policy, 'builder', task, 1, toolchain).model, profile.baseline.model);
  assert.equal(selectModel(policy, 'builder', { ...task, concerns: ['security'] }, 0, toolchain).model, profile.baseline.model);
  assert.equal(selectModel(policy, 'builder', { ...task, class: 'unknown' }, 0, toolchain).model, profile.baseline.model);
  assert.equal(selectModel(policy, 'builder', { ...task, paths: ['src/security.ts'] }, 0, toolchain).model, profile.baseline.model);
  assert.equal(selectModel(policy, 'auditor-tests', task, 0, toolchain).model, policy.roles['auditor-tests'].baseline.model);
  assert.equal(selectModel(policy, 'auditor-review', task, 0, toolchain).model, policy.roles['auditor-review'].baseline.model);
  report.pairs[0]!.candidate.acceptedDefects = 1;
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(policy, toolchain)), false);
  report.pairs[0]!.candidate.acceptedDefects = 0;
  assert.equal(qualifies(profile, 'different-cli', qualificationPolicyIdentity(policy, toolchain)), false);
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(policy, { ...toolchain, policy: '0.5.0' })), false);
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(policy, { ...toolchain, maxRepairs: 3 })), false);
  assert.equal(qualifies(profile, toolchain.codex, 'b'.repeat(64)), false);
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(policy, { ...toolchain, claude: 'changed-auditor-cli' })), false);
  const changedAuditor = structuredClone(policy); changedAuditor.roles['auditor-review'].inputBytes++;
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(changedAuditor, toolchain)), false);
  report.pairs[0]!.candidate.tokens = null;
  assert.equal(qualifies(profile, toolchain.codex, qualificationPolicyIdentity(policy, toolchain)), false);
});

test('token reservations include unsettled calls and never refund missing usage', () => {
  const policy = { enforcement: 'monitored' as const, maxTokensPerRun: 100, maxTokensPerCall: 60 };
  let ledger = reserveTokens({}, 'first', policy);
  assert.throws(() => reserveTokens(ledger, 'second', policy), /allowance/);
  ledger = settleTokens(ledger, 'first', 30);
  ledger = reserveTokens(ledger, 'second', policy);
  assert.deepEqual(tokenStatus(ledger, policy), { enforcement: 'monitored', consumed: 30, reserved: 60, remaining: 10, unknown: 1, exceeded: false });
  assert.deepEqual(settleTokens(ledger, 'first', 30), ledger);
  assert.throws(() => settleTokens(ledger, 'first', 29), /settlement/);
  assert.throws(() => settleTokens(ledger, 'second', -1), /usage/);
  const over = settleTokens(ledger, 'second', 100);
  assert.equal(tokenStatus(over, policy).remaining, 0);
  assert.equal(tokenStatus(over, policy).exceeded, true);
  assert.throws(() => reserveTokens(over, 'third', policy), /allowance/);
  assert.throws(() => reserveTokens({}, 'strict', { ...policy, enforcement: 'strict' }), /unsupported/);
});

test('the run policy identity binds model settings and context limits', async () => {
  const { policyIdentityFor, POLICY_IDENTITY, createRun, assertRunPolicy, POLICY, digest } = await import('../src/domain/workflow.js');
  const changed = structuredClone(toolchain);
  changed.models.roles.builder.baseline.effort = 'high';
  assert.notEqual(policyIdentityFor(changed), POLICY_IDENTITY);
  changed.models.roles.builder.inputBytes++;
  assert.notEqual(policyIdentityFor(changed), POLICY_IDENTITY);
  const run = createRun('test', 'host', 'owner/repo', POLICY.version, 1, { approver: { id: 1, login: 'operator' }, projectPolicy: digest('policy') });
  assert.throws(() => assertRunPolicy({ ...run, policyIdentity: policyIdentityFor(changed) }), /policy differs/);
});
