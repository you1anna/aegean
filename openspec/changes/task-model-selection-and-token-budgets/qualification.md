# Live qualification plan

Status: proposed for approval. This document authorises no live calls, installation or model activation.

## Scope

Qualify the Builder for `routine-cli` first. Compare the configured `gpt-6.1-sol` baseline with `gpt-6-luna`, both at medium effort.
These are requested identifiers, not confirmed subscription capabilities. Stage 1 must establish the actual served identities.
Keep both Auditors on their configured baseline. Keep the same context limits, protected verifier and approval rules in both arms.
[toolchain.json](../../../toolchain.json) owns those settings and the pinned CLI versions.

Use source candidate `b631e8d85b5fee81c2e1f5a2f568703e2399bf8f`, with the documentation follow-up at `bf5b92dd3cbe1fcff641319383f361e46a6000ec`.
The source, tests and policy are identical between these commits.
Any execution harness or policy change requires source review and fresh checks before the trial.
Record the exact installed artifact and policy identities before approval of execution.

Scout qualification is separate. Its exact smaller Claude model remains unresolved, so this proposal assigns it no live calls.
Success here permits no claim about Scout quality, general coding tasks, security changes or other task classes.

## Trial design

Use ten held-out synthetic CLI tasks and three paired attempts per task: 30 pairs, 60 arms.
Each arm starts from the same clean task snapshot and approved contract, with a fresh model context.
Alternate baseline-first and candidate-first order by pair number. Do not share generated answers between arms.

The changed variable is the initial Builder model. Repairs use the baseline in both arms.
Keep each arm's protected suite unchanged through repairs. Give paired arms the same protected expectations.
Include every failed attempt, repair, escalation and review in the report. Never replace a failed pair with an easier task.

A human reviews the public requirements and protected expectations before any model sees the tasks.
A baseline Auditor checks the candidate independently. The verifier evaluates every required case.
Record success, missed requirements and accepted defects separately. A passing public check alone does not establish quality.

## Fixture preparation

Create fresh repositories containing one existing command file and no external dependencies.
Keep oracle inputs, expected outputs and seeded defects outside candidate access and outside this repository.
Freeze the following public requests before execution:

| ID | Public requirement |
| --- | --- |
| echo | Echo one UTF-8 input line with exactly one final newline. |
| trim | Remove leading and trailing ASCII spaces; preserve internal spaces and other characters. |
| upper | Convert ASCII lowercase letters to uppercase; preserve every other character. |
| blank | Return one newline for empty input; preserve nonempty input with one final newline. |
| unicode | Preserve valid UTF-8 input, including combining characters; append a newline only when absent. |
| json-field | Read one JSON object; print its string `value` field and a newline; reject other field types. |
| invalid-json | Reject malformed JSON with exit code 2 and no stdout. |
| line-limit | Reject input above 128 UTF-8 bytes with exit code 2 and no partial stdout. |
| order | Preserve input line order, including empty lines; produce exactly one final newline. |
| exit-code | Map `ok` to 0, `retry` to 3 and every other input to 2, with no stdout. |

For each fixture, record the request, source-tree and protected-suite SHA-256 hashes in a private manifest.
Specify newline handling, invalid input and exit behaviour completely before the human approves that manifest.
Record a hash of the full manifest in the public report. Do not commit protected expectations or raw prompts.
The fixture repositories and private manifest do not yet exist; this table is a preparation specification, not execution evidence.

## Proposed budgets

All token values include input, output, cache and reasoning usage under the provider accounting rules.
They include failed calls and repairs. They are monitored allowances; an active call can exceed its reservation.

| Stage | Work | Maximum model calls | Token allowance | Active time |
| --- | --- | ---: | ---: | ---: |
| 1 | Identity and usage probes, at most two per requested Builder model | 4 | 20,000 total; 5,000 per call | 10 minutes total |
| 2 | First six pairs: two tasks, three attempts each, both arms | 96 | 720,000 total | 4 hours total |
| 3 | Remaining 24 pairs, after a human checkpoint | 384 | 2,880,000 total | 16 hours total |
| Entire trial | All stages, including unsuccessful attempts | 484 | 3,620,000 total | 20 hours 10 minutes |

For each arm in stages 2 and 3, propose 60,000 tokens, 10,000 tokens per call and eight model calls.
Allow at most two repairs, no contract revisions and 20 active minutes per arm.
The eight calls include all model roles; shared preparation calls also consume the stage allowance.
If preparation exhausts the allowance, stop. Do not treat it as free work outside the trial.
Unused allowance does not authorise extra attempts. A retry needs space within every applicable limit.

Run one arm at a time on the approved host. Retain the existing single-Builder permit and repository ownership checks.
The current coordinator enforces individual run admission, not a trial-wide aggregate budget.
A designated human must own the aggregate ledger and authorise each arm after inspection of remaining capacity.
Do not use an unattended batch until a reviewed controller enforces these aggregate limits.
Record consumed tokens and unresolved reservations before the next arm. Unknown usage stops the entire trial.

## Prerequisites and stop rules

Before execution approval, complete these checks:

1. Approve installation of the exact candidate through the maintained installer.
2. Establish native containment and protected-verifier prerequisites on the named host.
3. Approve the private fixture manifest, execution procedure and exact release identities.
4. Confirm subscription authentication and disabled paid overflow without changing billing settings.
5. Name the human who owns the aggregate ledger and approves each arm.
6. Set an absolute UTC expiry, no later than seven days after execution approval.

Stage 1 requires its own scoped live approval. Record actual model identities, usage events and CLI versions.
If model identity or complete usage cannot be established, stop before paired comparisons.
Do not substitute another model, CLI, paid API or synthetic usage record.
Stage 2 requires approval of those probe results and the frozen fixture manifest.
Stage 3 requires a human checkpoint after all six initial pairs pass the quality and accounting checks.

Stop on an expiry, exhausted allowance, missing usage, identity change, failed containment or ownership conflict.
A missed requirement or accepted defect stops progression and blocks qualification.
Preserve failed evidence. A changed contract, model, policy or fixture requires a new reviewed trial definition.

## Evidence, recovery and decision

Use private effect records and existing usage settlement. Do not create a second accounting implementation.
Use one immutable record per arm, with pair, attempt, role, model, policy, context and suite identities.
Capture console output and add each real run to [pilot notes](../../../docs/PILOT-NOTES.md), as the operations guide requires.
Keep logs, protected suites, prompts and run databases outside Git.

After interruption, reconcile effects before another call. Retain unknown reservations; never invent a refund or replay a completed call.
The operator ledger includes all previous charges after a resume. Expired approval requires a new human decision.

Apply the thresholds owned by [the policy validator](../../../src/domain/model-policy.ts):

- Ten distinct fixtures, three paired attempts each, with known usage for every attempt.
- All paired tasks succeed; no candidate misses a requirement or accepts a defect.
- Candidate median total tokens are at least 20% lower than baseline.
- Candidate token use at the 95th percentile does not exceed baseline.

Report first-pass success, repairs, elapsed time and peak context as secondary measures.
Compare complete arm costs, including baseline repairs and Auditor calls, not only the first Builder response.
Thirty pairs support a decision for this narrow class; they do not establish general model equivalence.

Publish a compact report with manifest hash, all pair outcomes, aggregate usage, threshold results and unresolved limits.
Obtain independent review of that evidence. Then request approval of a policy change on the current PR.
Keep the baseline active until the report passes and that policy change receives approval.

## Approval requested

Approve or amend this Builder-only plan and its proposed allowances.
Plan approval permits fixture and execution-package preparation; it does not authorise live execution.
The staged approvals above bind actual artifacts, host readiness, model identities and expiry before subscription capacity is used.
Installation, activation and merge retain separate approvals.
