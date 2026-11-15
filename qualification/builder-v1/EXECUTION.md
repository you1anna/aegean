# Execution package for approval

Prepared on 15 November 2026. The operator approved fixture preparation and the trial plan; live execution remains unauthorised.

## Fixed inputs

- Runtime source: `b631e8d85b5fee81c2e1f5a2f568703e2399bf8f`; policy version 0.4.0.
- Codex CLI: 0.167.2. Requested models: `gpt-6.1-sol` and `gpt-6-luna`, both at medium effort.
- Host: primary Mac. The operator owns the aggregate ledger and approves each arm.
- Fixtures and order: [manifest](manifest.json) and [schedule](schedule.json).
- Protected package: `~/.local/state/aegean/qualification/builder-v1-20261115/`.
- Proposed execution expiry: 22 November 2026 at 13:00 UTC, or seven days after approval, whichever is earlier.

The release artifact identity does not yet exist for this installed candidate. Record it after separately approved installation.
An expired proposal requires a new absolute expiry before approval.

## Next live scope: stage 1 only

Use an empty synthetic checkout. Give no real project data or protected fixture content to a model.
Execute these calls serially, each in a fresh context:

| Call | Requested model | Task | Token reservation | Maximum active time |
| --- | --- | --- | ---: | ---: |
| 1 | `gpt-6.1-sol` | Return the exact text `AEGEAN_PROBE` without tools. | 5,000 | 150 seconds |
| 2 | `gpt-6-luna` | Same task as call 1. | 5,000 | 150 seconds |
| 3 | `gpt-6.1-sol` | Return a JSON object with only `status` equal to `ok`, without tools. | 5,000 | 150 seconds |
| 4 | `gpt-6-luna` | Same task as call 3. | 5,000 | 150 seconds |

Total: four calls, 20,000 tokens and ten active minutes. No retry, repair, publication or fixture implementation is included.
Use subscription authentication only. Preserve the adapter's restricted configuration, ephemeral sessions and API-override rejection.
Record the actual served model, terminal usage events, duration, exit status and raw-output hash for each call.
Use the existing provider parser. Unknown identity or usage stops the stage; never infer zero usage.
Do not make the next call if any reservation is unresolved or the remaining allowance is below 5,000 tokens.

These are monitored limits. A call can overrun its reservation before the result becomes available.
An overrun stops subsequent calls. Approval must acknowledge this limit; no provider-enforced token ceiling is claimed.

## Stages 2 and 3

After stage 1, request separate approval of its results and the exact installed artifact before paired execution.
Stage 2 comprises the first six pairs in the schedule: echo and trim, three attempts each, 12 arms.
Its aggregate allowance is 720,000 tokens, 96 model calls and four active hours.
Stage 3 comprises the other 24 pairs: 48 arms, 2,880,000 tokens, 384 model calls and 16 active hours.
The [approved plan](../../openspec/changes/task-model-selection-and-token-budgets/qualification.md) owns the quality thresholds and stop rules.

Use a fresh Git repository for each arm, copied only from its public fixture directory.
Record the initial tree, approved contract and protected-suite hashes before execution.
Keep generated tests and oracle expectations outside candidate access. Never copy the private package into a candidate checkout.
A human must confirm equal contracts and protected expectations across each pair.

## Readiness findings

The read-only doctor assessment on 15 November reported:

- Codex subscription authentication passed; paid overflow was recorded as disabled.
- Claude subscription authentication was not verified in this environment.
- The dedicated verifier VM was unavailable.
- The installed bootstrap did not have full release acceptance.

No installation, VM start, authentication change or acceptance override occurred during preparation.
Native containment and protected-verifier checks remain required before contained Builder execution.

The current production selector correctly refuses an unqualified candidate.
Do not insert synthetic qualification evidence to force it to select the trial model.
A comparison entry point must invoke the explicit adapter profile under real budget, ownership and evidence controls.
That entry point is not implemented by this documentation package and requires reviewed source work before paired execution.
The existing host qualification command tests native controls; it is not a model-comparison runner.

## Operator record and recovery

Before each call, record approval identity, expiry, release identity, requested model and the reserved allowance.
After each call, record effect identity, reported model, consumed tokens, unresolved reservations and remaining aggregate allowance.
Store the ledger and raw output in the private package. Add each real run to `docs/PILOT-NOTES.md` without raw content.
Reconcile interrupted effects before any retry. Preserve uncertain charges and completed results.
One operator and one active arm avoid competing aggregate admissions; existing repository and Builder permits remain mandatory.

## Approval boundary

This package is reviewable but not ready for execution. Installation identity and native readiness are still missing.
The next live request is stage 1 only, conditional on those prerequisites and a reviewed invocation procedure.
Do not treat approval of this document as approval to bypass a missing control or enable smaller models.
