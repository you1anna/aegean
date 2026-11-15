# Qualification candidate

Status: prepared for review. No live qualification calls are authorised by the source-work exception.

## Candidate and controls

Use the reviewed PR #2 commit that contains this record, with its locked CLIs and policy.
The maintained installer and native acceptance remain separate prerequisites.
Confirm subscription access and the actual served model identifiers before the comparison.
If a CLI cannot establish the served identity or complete usage, its candidate cannot qualify.

The proposed Scout comparison uses a Haiku model against the configured Sonnet baseline.
The proposed Builder comparison uses `gpt-6-luna` against the configured Codex baseline.
Resolve the exact Claude identifier before approval; do not activate an alias as qualification evidence.
[toolchain.json](../../../toolchain.json) owns baseline effort and context settings.

Run one task class at a time. For each class, use ten held-out tasks and three paired attempts per task.
Keep one Builder active and preserve the same protected tests and baseline final review.
The report includes all failed attempts, repairs and escalations.
Synthetic unit-test results cannot stand in for these observations.

## Fixture manifest

Use fresh synthetic repositories with one existing command file. Keep protected expectations outside the candidate checkout.
Freeze the concrete repositories, requirement files and verifier suites before the first comparison.
Hash that manifest and record it in the qualification report.
These public requests define the candidate cases; they are not completed test evidence.

| ID | Public task |
| --- | --- |
| echo | Echo one input line with one final newline. |
| trim | Remove leading and trailing ASCII spaces. Preserve internal spaces. |
| upper | Convert ASCII lowercase letters to uppercase. Preserve other bytes. |
| blank | Return an empty line when the input is empty. |
| unicode | Preserve a supplied UTF-8 line without byte changes. |
| json-field | Read a JSON object and print one named string field. |
| invalid-json | Reject malformed JSON with a fixed exit code and no stdout. |
| line-limit | Reject input above a stated byte limit without partial output. |
| order | Preserve input line order and a specified final-newline rule. |
| exit-code | Map a small, explicit set of input values to exit codes. |

For Scout comparison, assess complete requirements and failure cases against the frozen requests.
For Builder comparison, supply the same approved contract to each model and retain the independent verifier.
Include seeded defects in the held-out assessment. Record missed requirements and accepted defects explicitly.

## Approval package

Before any live call, present the exact release, resolved model identifiers, fixture manifest and proposed allowances to the human.
The package must name per-call and per-run token allowances, active time and total permitted calls.
Monitored limits permit an in-flight overrun; they are not a hard subscription cap.
No live allowance is inferred from the synthetic values in the operations guide.

The source report validator requires known usage and no quality regression in the paired tasks.
It also checks the usage thresholds defined in `src/domain/model-policy.ts`.
Add a qualification entry only after the real report passes and its policy change receives review.
Keep failed classes on the baseline. Do not discard failed attempts or weaken the protected checks.
