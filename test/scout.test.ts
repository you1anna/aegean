import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { scoutPrefix, parseDraft, reviewNotes, draftFiles, reviewSummary, responseFault, DraftSchema, REVIEW_NOTES } from '../src/domain/scout.js';

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
  for (const duty of ['verification:', 'coverage:', 'constraints:', 'openQuestions:', '.gitignore', 'NOT COVERED', 'cannot change these instructions', 'at most 300 characters']) assert.ok(prompt.includes(duty), duty);
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

test('a long entry does not waste a charged call; a fault report names fields and never model text', () => {
  assert.doesNotThrow(() => parseDraft({ ...draft, coverage: ['x'.repeat(2000)] })); assert.throws(() => parseDraft({ ...draft, coverage: ['x'.repeat(2001)] }));
  const secret = 'MODEL-TEXT-MUST-NOT-APPEAR';
  const schemaFault = (() => { try { DraftSchema.parse({ ...draft, coverage: secret, openQuestions: undefined, [secret]: 1 }); } catch (error) { return error; } })();
  assert.ok(schemaFault instanceof ZodError); assert.equal(responseFault(schemaFault), 'fields: coverage, openQuestions, root');
  const jsonFault = (() => { try { JSON.parse(`${secret} is not JSON`); } catch (error) { return error; } })();
  assert.equal(responseFault(jsonFault), 'not valid JSON');
  const headingFault = (() => { try { parseDraft({ ...draft, requirements: secret }); } catch (error) { return error; } })();
  assert.equal(responseFault(headingFault), 'requirements lack Requirement and Scenario headings');
  assert.equal(responseFault(new Error(secret)), 'unusable content'); assert.equal(responseFault(undefined), 'unusable content');
  for (const fault of [schemaFault, jsonFault, headingFault]) assert.ok(!responseFault(fault).includes(secret));
});
