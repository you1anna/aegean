import { STOP_REASONS } from '../src/domain/run.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSteps, listSteps } from '../src/domain/next-steps.js';
import { recoveryHint } from '../src/application/cli-arguments.js';
import { repeatedPilot, type PilotArtifact } from '../src/application/pilot.js';
import { defaultBudget } from '../src/domain/budgets.js';
import { compareVersions, isStableVersion, matchesVersion } from '../scripts/cli-version.mjs';

test('every run state has operator guidance that names an exact command or an end', () => {
  const id = 'run-00000000-0000-4000-8000-000000000000';
  assert.match(nextSteps({ id, state: 'requested' })[0]!, /authorize-pilot --run run-0.* --limits FILE/);
  assert.deepEqual(nextSteps({ id, state: 'requested' }, { pilotExpiresAt: 2000 }, 1000), [`Draft the specification (one model call): aegean resume --run ${id}`]);
  // An expired authorisation blocks every live state; guidance must not send the operator to a command that fails.
  for (const state of ['requested', 'spec-drafted', 'building', 'human-merge-review', 'merged', 'paused'] as const) {
    const expired = nextSteps({ id, state }, { pilotExpiresAt: 1000 }, 1000);
    assert.match(expired[0]!, /expired at 1970-01-01T00:00:01\.000Z\. It cannot be replaced/); assert.match(expired[1]!, /aegean cancel --run/); assert.ok(!expired.join().includes('resume'));
  }
  assert.match(nextSteps({ id, state: 'cancelled' }, { pilotExpiresAt: 1000 }, 2000)[0]!, /This run is complete/);
  const drafted = nextSteps({ id, state: 'spec-drafted' }, { specification: '/state/spec/' });
  assert.match(drafted[0]!, /review-notes\.md.*\/state\/spec\//); assert.ok(drafted.some(step => step.includes(`aegean approve --run ${id}`)));
  for (const state of ['spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair', 'merged'] as const) assert.match(nextSteps({ id, state }).join(), /aegean resume --run/);
  assert.match(nextSteps({ id, state: 'human-merge-review' })[0]!, /aegean publish --run/);
  assert.match(nextSteps({ id, state: 'human-merge-review', publicationRef: 'ref' })[0]!, /merge the pull request yourself/);
  assert.match(nextSteps({ id, state: 'paused', reason: 'scout: quota' })[0]!, /scout: quota/);
  assert.match(nextSteps({ id, state: 'escalated', reason: 'repair attempts exhausted' })[0]!, /cannot continue: repair attempts exhausted/);
  // A stop by a check or a finding owner names the private file that holds the evidence.
  assert.deepEqual(nextSteps({ id, state: 'escalated', reason: STOP_REASONS.spec, repairs: 1 }, { runFolder: '/state/runs/r' }).slice(0, 2), [`The run stopped and cannot continue: ${STOP_REASONS.spec}`, 'Read the review findings in /state/runs/r/review-1.json']);
  assert.match(nextSteps({ id, state: 'escalated', reason: STOP_REASONS.factory, repairs: 0 }, { runFolder: '/r' }).join('\n'), /review-0\.json/);
  assert.match(nextSteps({ id, state: 'escalated', reason: STOP_REASONS.baseline }, { runFolder: '/r' }).join('\n'), /base commit results in \/r\/baseline\.json/);
  assert.doesNotMatch(nextSteps({ id, state: 'escalated', reason: 'repair attempts exhausted' }, { runFolder: '/r' }).join('\n'), /\/r\//);
  for (const state of ['cancelled', 'archived'] as const) assert.match(nextSteps({ id, state })[0]!, /aegean prepare --request FILE/);
  assert.match(listSteps(['cancelled', 'archived'])[0]!, /No run is active/); assert.match(listSteps([])[0]!, /No run is active/);
  assert.match(listSteps(['cancelled', 'spec-drafted'])[0]!, /status --run ID/);
});

test('recovery hints name the missing step and keep the general fallback', () => {
  assert.match(recoveryHint('resume', '--run is required'), /A run exists only after aegean prepare --request FILE/);
  assert.match(recoveryHint('authorize-pilot', '--expires-at is required'), /--limits FILE/);
  assert.match(recoveryHint('authorize-pilot', 'limits file cannot be combined with individual pilot flags'), /Run aegean status and inspect/);
  assert.match(recoveryHint('prepare', 'commit or preserve current work before starting an isolated run'), /push main/);
  assert.match(recoveryHint('authorize-pilot', 'missing builder-isolation prerequisite evidence for this host'), /aegean qualify.*aegean doctor --require prerequisites/);
  assert.match(recoveryHint('authorize-pilot', 'protected-verifier prerequisite evidence is not passing (fail)'), /aegean qualify/);
  assert.match(recoveryHint('project', 'required context missing: docs/a.md'), /modelExecution\.task\.paths/);
  assert.equal(recoveryHint('configure', '--run is required'), 'Inspect host configuration in the operations guide before retrying.');
  assert.equal(recoveryHint('resume', 'synthetic unknown failure'), 'Run aegean status and inspect the operations guide before retrying effects.');
});

test('a repeated pilot request reports the saved decision; no other request replaces it', () => {
  const run = 'run-00000000-0000-4000-8000-000000000000', now = 1_000_000;
  const saved = { run, expiresAt: now + 60_000, budget: defaultBudget, limitsDigest: 'a'.repeat(64) } as PilotArtifact;
  // A limits file gives a new expiry on each command; the reviewed limits identify the request.
  assert.deepEqual(repeatedPilot(saved, run, { expiresAt: now + 999_000, budget: { ...defaultBudget }, limitsDigest: 'a'.repeat(64) }, now), { alreadyAuthorized: true, expiresAt: new Date(now + 60_000).toISOString(), budget: defaultBudget });
  assert.throws(() => repeatedPilot(saved, run, { expiresAt: now + 60_000, budget: defaultBudget, limitsDigest: 'b'.repeat(64) }, now), /different limits/);
  assert.throws(() => repeatedPilot(saved, run, { expiresAt: now + 60_000, budget: { ...defaultBudget, maxModelCalls: defaultBudget.maxModelCalls - 1 }, limitsDigest: 'a'.repeat(64) }, now), /different limits/);
  assert.throws(() => repeatedPilot(saved, run, { expiresAt: now + 60_000, limitsDigest: 'a'.repeat(64) }, now), /different limits/);
  assert.throws(() => repeatedPilot(saved, run, { expiresAt: now + 60_000, budget: defaultBudget, limitsDigest: 'a'.repeat(64) }, now + 60_000), /expired at .* cannot be replaced/);
  assert.throws(() => repeatedPilot(saved, 'run-other', { budget: defaultBudget, limitsDigest: 'a'.repeat(64) }, now), /another run/);
  const flags = { ...saved, limitsDigest: undefined } as PilotArtifact;
  assert.equal(repeatedPilot(flags, run, { expiresAt: now + 60_000, budget: defaultBudget }, now).alreadyAuthorized, true);
  assert.throws(() => repeatedPilot(flags, run, { expiresAt: now + 61_000, budget: defaultBudget }, now), /different limits/);
});

test('version order is numeric and has one owner for CLI ranges and project standards', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1); assert.equal(compareVersions('1.2.3', '1.2.3'), 0); assert.equal(compareVersions('0.4.9', '0.5.0'), -1);
  assert.equal(isStableVersion('0.5.0'), true); for (const value of ['0.5', 'v0.5.0', '0.5.0-rc1', '00.5.0', '']) assert.equal(isStableVersion(value), false, value);
  assert.equal(matchesVersion('2.1.325 (Claude Code)', '>=2.1.322 <3.0.0'), true); assert.equal(matchesVersion('3.0.0', '>=2.1.322 <3.0.0'), false);
});
