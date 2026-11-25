/**
 * The protected acceptance case contract. The suite schema and the verifier adapter enforce these limits.
 * The Scout, the test Auditor and the Builder get the same rules, so that the contract, the cases and the code agree.
 */
export const CASE_LIMITS = { textChars: 8192, maxCases: 100, maxExit: 125, seconds: 15, outputBytes: 128_000, tmpMegabytes: 32 } as const;

/** The rules of one protected case, for each role prompt that must agree on them. */
export function caseRules(command: readonly string[]): string {
  return [
    `Each protected case runs the fixed verifier command ${JSON.stringify(command)} once, in a new container, with one stdin text and no other arguments.`,
    `The stdin text and the expected stdout each have at most ${CASE_LIMITS.textChars} characters.`,
    'A case passes only if the exit code and the complete stdout are equal to the expected values; only white space at the end of stdout is ignored.',
    `Each case has ${CASE_LIMITS.seconds} seconds, no network, read-only project files, an empty writable /tmp of ${CASE_LIMITS.tmpMegabytes} MB and at most ${CASE_LIMITS.outputBytes} bytes of output.`,
    'An absent or broken entry point exits with code 1 and prints no stdout.',
  ].join(' ');
}
