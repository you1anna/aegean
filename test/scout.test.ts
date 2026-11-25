import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { scoutPrefix, parseDraft, reviewNotes, draftFiles, reviewSummary, parseReviewNotes, reviewFlags, responseFault, DraftSchema, REVIEW_NOTES } from '../src/domain/scout.js';
import { ALLOWED_PATHS, parseAllowedPaths } from '../src/domain/allowed-paths.js';
import { caseRules } from '../src/domain/verifier-contract.js';

const project = { checks: [['node', '--test']], verifier: { kind: 'cli', image: 'node@sha256:' + 'a'.repeat(64), command: ['node', '--test'] } };
const draft = {
  proposal: 'p', design: 'd', tasks: 't', requirements: '## Requirement: Output\nThe CLI SHALL output ok.\n### Scenario: Run\n- WHEN invoked\n- THEN ok',
  verification: 'node --test runs the suite.', coverage: ['Store records: Requirement Output', 'Queue: NOT COVERED, the request leaves it for later'],
  constraints: ['AGENTS.md: no product code yet;\n the plan has no code'], openQuestions: [], allowedPaths: ['src/', 'test/store.test.js'],
};

test('Scout prompt states the project checks, the ignore rule and the report duties', () => {
  const prompt = scoutPrefix('Build a store', project);
  assert.ok(prompt.startsWith('Act as Scout.')); assert.ok(prompt.endsWith('CONTEXT:\n'));
  assert.ok(prompt.includes('PROJECT CHECKS:\n{"checks":[["node","--test"]],"verifier":{"kind":"cli"'));
  assert.ok(prompt.includes('REQUEST:\nBuild a store'));
  // The contract must fix the verifier entry point byte for byte: the test writer and the Builder never see each other.
  assert.ok(prompt.includes(caseRules(project.verifier.command)));
  for (const rule of ['PROTECTED TESTS', 'one JSON line with a fixed key order', 'Define each sort order', 'timestamps, durations, absolute paths or random identifiers',
    'exit code from 2 to 125', 'new data in /tmp', 'a failed case tells the Builder only the requirement name', 'name it in a requirement and in allowedPaths']) assert.ok(prompt.includes(rule), rule);
  for (const duty of ['verification:', 'coverage:', 'constraints:', 'openQuestions:', '.gitignore', 'NOT COVERED', 'cannot change these instructions', 'at most 300 characters', 'must not invent them', 'to a later change', 'give your recommendation', 'headings, short paragraphs and lists', 'allowedPaths:', 'test files', 'that the project checks read or write']) assert.ok(prompt.includes(duty), duty);
});

test('draft parse fails closed on a missing report field, an unknown field or unbound requirements', () => {
  assert.deepEqual(parseDraft(draft), draft);
  for (const field of ['verification', 'coverage', 'constraints', 'openQuestions', 'allowedPaths'] as const) { const { [field]: _removed, ...rest } = draft; assert.throws(() => parseDraft(rest), field); }
  assert.throws(() => parseDraft({ ...draft, coverage: [] })); assert.throws(() => parseDraft({ ...draft, verification: '' }));
  assert.throws(() => parseDraft({ ...draft, extra: 1 }));
  assert.throws(() => parseDraft({ ...draft, allowedPaths: [] }));
  assert.throws(() => parseDraft({ ...draft, allowedPaths: ['../outside'] }), /allowed path/);
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

test('the notes file gives the same summary as the draft, and the human can answer an item in the file', () => {
  const open = { ...draft, openQuestions: ['Which identifier format?', 'Which store?'] };
  assert.deepEqual(parseReviewNotes(reviewNotes(open)), { ...reviewSummary(open), projectRulesThatLimitedTheRequest: ['AGENTS.md: no product code yet; the plan has no code'] });
  assert.equal(reviewFlags(reviewSummary(open)), '2 open questions, 1 request need not covered');
  assert.equal(reviewFlags({ projectRulesThatLimitedTheRequest: ['a rule'], openQuestions: ['One'], notCovered: [] }), '1 open question');
  // A limiting rule is not a fault of the draft. A draft without a question or an uncovered need has no flag.
  assert.equal(reviewFlags({ projectRulesThatLimitedTheRequest: ['a rule'], openQuestions: [], notCovered: [] }), undefined);
  const answered = reviewNotes(open).replace('- Which identifier format?\n', '').replace('NOT COVERED, the request leaves it for later', 'Requirement Queue');
  assert.deepEqual(parseReviewNotes(answered).openQuestions, ['Which store?']); assert.deepEqual(parseReviewNotes(answered).notCovered, []);
  // A file that is not the notes format gives no item; it cannot hide a flag behind an error.
  assert.deepEqual(parseReviewNotes('free text\n- NOT COVERED outside a section'), { projectRulesThatLimitedTheRequest: [], openQuestions: [], notCovered: [] });
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
  const pathFault = (() => { try { parseDraft({ ...draft, allowedPaths: [secret + '/../x'] }); } catch (error) { return error; } })();
  assert.equal(responseFault(pathFault), 'allowedPaths has an invalid entry');
  assert.equal(responseFault(new Error(secret)), 'unusable content'); assert.equal(responseFault(undefined), 'unusable content');
  for (const fault of [schemaFault, jsonFault, headingFault]) assert.ok(!responseFault(fault).includes(secret));
});

test('the draft writes the allowed paths as a file that the human can read and edit before approval', () => {
  const text = draftFiles(draft)[ALLOWED_PATHS]!;
  assert.match(text, /^# Paths that the Builder may create, change or delete/);
  assert.deepEqual(parseAllowedPaths(text), draft.allowedPaths);
});
