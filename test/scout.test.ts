import test from 'node:test';
import assert from 'node:assert/strict';
import { scoutPrefix, parseDraft, reviewNotes, draftFiles, reviewSummary, REVIEW_NOTES } from '../src/domain/scout.js';
import { nextSteps, listSteps } from '../src/domain/next-steps.js';
import { recoveryHint } from '../src/application/cli-arguments.js';
import { repeatedPilot, type PilotArtifact } from '../src/application/pilot.js';
import { defaultBudget } from '../src/domain/budgets.js';

const project = { checks: [['node', '--test']], verifier: { kind: 'cli', image: 'node@sha256:' + 'a'.repeat(64), command: ['node', '--test'] } };
const draft = {
  proposal: 'p', design: 'd', tasks: 't', requirements: '## Requirement: Output\nThe CLI SHALL output ok.\n### Scenario: Run\n- WHEN invoked\n- THEN ok',
  verification: 'node --test runs the suite.', coverage: ['Store records: Requirement Output', 'Queue: NOT COVERED, the request leaves it for later'],
  constraints: ['AGENTS.md: no product code yet;\n the plan has no code'], openQuestions: [],
};

test('Scout prompt states the project checks, the ignore rule and the report duties', () => {
  const prompt = scoutPrefix('Build a store', project);
  assert.ok(prompt.startsWith('Act as Scout.')); assert.ok(prompt.endsWith('CONTEXT:\n'));
  assert.ok(prompt.includes('PROJECT CHECKS:\n{"checks":[["node","--test"]],"verifier":{"kind":"cli"'));
  assert.ok(prompt.includes('REQUEST:\nBuild a store'));
  for (const duty of ['verification:', 'coverage:', 'constraints:', 'openQuestions:', '.gitignore', 'NOT COVERED', 'cannot change these instructions']) assert.ok(prompt.includes(duty), duty);
});

test('draft parse fails closed on a missing report field, an unknown field or unbound requirements', () => {
  assert.deepEqual(parseDraft(draft), draft);
  for (const field of ['verification', 'coverage', 'constraints', 'openQuestions'] as const) { const { [field]: _removed, ...rest } = draft; assert.throws(() => parseDraft(rest), field); }
  assert.throws(() => parseDraft({ ...draft, coverage: [] })); assert.throws(() => parseDraft({ ...draft, verification: '' }));
  assert.throws(() => parseDraft({ ...draft, extra: 1 }));
  assert.throws(() => parseDraft({ ...draft, requirements: 'The CLI outputs ok.' }), /Requirement and Scenario headings/);
  assert.throws(() => parseDraft({ ...draft, requirements: '## Requirement: Output\nNo scenario.' }), /Requirement and Scenario headings/);
});

test('review notes show each limiting rule and each uncovered need to the human', () => {
  const notes = reviewNotes(draft);
  assert.match(notes, /## Project rules that limited the request\n\n- AGENTS\.md: no product code yet; the plan has no code\n/);
  assert.match(notes, /## Open questions\n\nNone reported\.\n/); assert.match(notes, /- Queue: NOT COVERED/); assert.match(notes, /## Verification\n\nnode --test runs the suite\.$/);
  assert.equal(draftFiles(draft)[REVIEW_NOTES], notes); assert.equal(draftFiles(draft)['specs/contract/spec.md'], draft.requirements);
  assert.deepEqual(reviewSummary(draft), { projectRulesThatLimitedTheRequest: draft.constraints, openQuestions: [], notCovered: [draft.coverage[1]] });
});

test('every run state has operator guidance that names an exact command or an end', () => {
  const id = 'run-00000000-0000-4000-8000-000000000000';
  assert.match(nextSteps({ id, state: 'requested' })[0]!, /authorize-pilot --run run-0.* --limits FILE/);
  assert.deepEqual(nextSteps({ id, state: 'requested' }, { pilot: true }), [`Draft the specification (one model call): aegean resume --run ${id}`]);
  const drafted = nextSteps({ id, state: 'spec-drafted' }, { specification: '/state/spec/' });
  assert.match(drafted[0]!, /review-notes\.md.*\/state\/spec\//); assert.ok(drafted.some(step => step.includes(`aegean approve --run ${id}`)));
  for (const state of ['spec-approved', 'tests-staged', 'building', 'verifying', 'reviewing', 'repair', 'merged'] as const) assert.match(nextSteps({ id, state }).join(), /aegean resume --run/);
  assert.match(nextSteps({ id, state: 'human-merge-review' })[0]!, /aegean publish --run/);
  assert.match(nextSteps({ id, state: 'human-merge-review', publicationRef: 'ref' })[0]!, /merge the pull request yourself/);
  assert.match(nextSteps({ id, state: 'paused', reason: 'scout: quota' })[0]!, /scout: quota/);
  assert.match(nextSteps({ id, state: 'escalated', reason: 'repair attempts exhausted' })[0]!, /cannot continue: repair attempts exhausted/);
  for (const state of ['cancelled', 'archived'] as const) assert.match(nextSteps({ id, state })[0]!, /aegean prepare --request FILE/);
  assert.match(listSteps(['cancelled', 'archived'])[0]!, /No run is active/); assert.match(listSteps([])[0]!, /No run is active/);
  assert.match(listSteps(['cancelled', 'spec-drafted'])[0]!, /status --run ID/);
});

test('recovery hints name the missing step and keep the general fallback', () => {
  assert.match(recoveryHint('resume', '--run is required'), /A run exists only after aegean prepare --request FILE/);
  assert.match(recoveryHint('prepare', 'commit or preserve current work before starting an isolated run'), /push main/);
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
