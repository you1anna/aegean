import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedPaths, formatAllowedPaths, outsideAllowedPaths } from '../src/domain/allowed-paths.js';
import { baselineSummary, baselineReport } from '../src/domain/baseline.js';
import { builderFindings, findingCounts, repairFeedback } from '../src/domain/feedback.js';
import { ReviewSchema } from '../src/domain/config.js';

test('allowed paths accept files and directories and refuse unsafe or protected entries', () => {
  assert.deepEqual(parseAllowedPaths('# comment\n\nsrc/\nREADME.md\n  test/cli.test.js  \n'), ['src/', 'README.md', 'test/cli.test.js']);
  assert.deepEqual(parseAllowedPaths(formatAllowedPaths(['app.cjs', 'docs/'])), ['app.cjs', 'docs/']);
  for (const unsafe of ['/etc/passwd', '../outside', 'src/../x', './app.cjs', 'src//x', 'a\\b', '.git/config', 'sub/.git/', 'aegean.json', 'x'.repeat(201)]) {
    assert.throws(() => parseAllowedPaths(unsafe), /allowed path/, unsafe);
  }
  assert.throws(() => parseAllowedPaths('# nothing\n'), /at least one/);
  assert.throws(() => parseAllowedPaths('app.cjs\napp.cjs\n'), /repeated/);
  assert.throws(() => parseAllowedPaths(Array.from({ length: 101 }, (_, n) => `f${n}`).join('\n')), /at most 100/);
});

test('a changed path is outside unless an exact file or a directory entry allows it', () => {
  const allowed = ['src/', 'README.md'];
  const changed = ['src/cli.js', 'src/deep/x.js', 'README.md', 'README.md.bak', 'srcx/a.js', 'openspec/changes/run-1/spec.md', 'package.json'];
  assert.deepEqual(outsideAllowedPaths(changed, allowed, 'openspec/changes/run-1/'), ['README.md.bak', 'srcx/a.js', 'package.json']);
  assert.deepEqual(outsideAllowedPaths([], allowed, 'openspec/changes/run-1/'), []);
});

test('base commit results roll up each test case to its requirement', () => {
  const requirements = ['R001', 'R001', 'R002', 'R003', 'R004'];
  const summary = baselineSummary(requirements, ['pass', 'fail', 'pass', 'pass']);
  assert.deepEqual(summary, { cases: 5, passed: 3, failed: 1, notRun: 1, seenFailing: ['R001'], alreadyPassing: ['R002', 'R003'], notRunRequirements: ['R004'] });
  assert.equal(baselineSummary(['R001'], ['pass']).passed, 1);
  assert.throws(() => baselineSummary(['R001'], ['pass', 'pass']), /more results than cases/);
});

test('review findings carry one owner each and only Builder findings reach the Builder', () => {
  const review = ReviewSchema.parse({ outcome: 'repair', findings: [{ owner: 'builder', finding: 'Handle empty input' }, { owner: 'spec', finding: 'R002 contradicts R001' }, { owner: 'factory', finding: 'Test expects a trailing space' }] });
  assert.deepEqual(findingCounts(review), { builder: 1, spec: 1, factory: 1 });
  assert.deepEqual(builderFindings(review), ['Handle empty input']);
  assert.throws(() => ReviewSchema.parse({ outcome: 'repair', findings: ['untyped finding'] }));
  assert.throws(() => ReviewSchema.parse({ outcome: 'repair', findings: [{ owner: 'reviewer', finding: 'x' }] }));
});

test('a scope breach tells the Builder which paths to restore', () => {
  assert.deepEqual(repairFeedback('outside-allowed-paths', [], '### Requirement: Output\n', ['extra.txt']), ['The candidate changes paths that allowed-paths.txt does not allow: ["extra.txt"]. Change only the allowed paths.']);
  assert.deepEqual(repairFeedback('protected-requirement-failed', ['R001'], '### Requirement: Output\n', ['ignored']), ['Protected acceptance found a public requirement violation.', 'R001: Output']);
});

test('the publication report names requirements that already passed before the change', () => {
  const report = baselineReport(baselineSummary(['R001', 'R002', 'R003'], ['fail', 'pass']));
  assert.equal(report, [
    'On the base commit, 1 of 3 protected tests failed, 1 passed and 1 did not run.',
    'Requirements with a test that failed before the change: R001.',
    'Requirements whose tests already passed before the change: R002. Their tests do not show that the change works.',
    'Requirements not tested on the base commit: R003.',
  ].join('\n'));
});
