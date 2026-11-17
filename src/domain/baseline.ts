export type CaseResult = 'pass' | 'fail';

/**
 * Results of the protected suite on the base commit, in suite order. A case that did not run has no result.
 * A test that passes before the change cannot show that the change works.
 */
export function baselineSummary(requirements: readonly string[], results: readonly CaseResult[]) {
  if (results.length > requirements.length) throw new Error('base commit results have more results than cases');
  const unique = [...new Set(requirements)];
  const failedIn = new Set(requirements.filter((_, index) => results[index] === 'fail'));
  const notRunIn = new Set(requirements.filter((_, index) => results[index] === undefined));
  return {
    cases: requirements.length,
    passed: results.filter(result => result === 'pass').length,
    failed: results.filter(result => result === 'fail').length,
    notRun: requirements.length - results.length,
    seenFailing: unique.filter(id => failedIn.has(id)),
    alreadyPassing: unique.filter(id => !failedIn.has(id) && !notRunIn.has(id)),
    notRunRequirements: unique.filter(id => !failedIn.has(id) && notRunIn.has(id)),
  };
}
export type BaselineSummary = ReturnType<typeof baselineSummary>;

/** Plain text for the human at publication. It names requirement identifiers only, never test content. */
export function baselineReport(summary: BaselineSummary): string {
  const list = (items: string[]) => items.length ? items.join(', ') : 'none';
  return [
    `On the base commit, ${summary.failed} of ${summary.cases} protected tests failed, ${summary.passed} passed and ${summary.notRun} did not run.`,
    `Requirements with a test that failed before the change: ${list(summary.seenFailing)}.`,
    `Requirements whose tests already passed before the change: ${list(summary.alreadyPassing)}. Their tests do not show that the change works.`,
    ...(summary.notRunRequirements.length ? [`Requirements not tested on the base commit: ${list(summary.notRunRequirements)}.`] : []),
  ].join('\n');
}
