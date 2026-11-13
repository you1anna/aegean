# Local test findings — 13 November 2026

## Follow-up verification

The final local suite on `bounded-cli` passed **141/141**, with zero failures,
skips or cancellations. It took **262.71 seconds** including the build and used
**244.27 CPU-seconds** (158.56 user, 85.71 system). Compared with the baseline
below, elapsed time fell by 65% and CPU time by 67%. Both runs were serial on the
primary Mac with local sockets enabled. Hosted CI and native acceptance remain
pending.

- The fake VM now drains snapshot output before exiting. The oversized candidate
  reaches the review limit and neither invokes the Auditor nor publishes.
- The lifecycle fixture publishes and checks the candidate ref before simulating
  a merge. It verifies that an unapproved merger cannot trigger archival.
- The installer fixture includes the current scripts, compiled source modules
  and locked runtime dependencies. Its clean-build and stale-output assertions
  passed.
- The coordinator fixture calls real local Git directly for routine operations.
  The existing lost-push test passed with synthetic fault injection still active.
  The full suite now has a five-minute timeout per test.

Offline dependency installation, type checking, the 16-test quick check and
focused reruns of all three regressions also passed. Test execution used
synthetic model CLIs.

## Baseline checkout

Tested checkout: `bbae1b5`, branch `bounded-cli`,
with the local quick-test command and testing documentation changes. No runtime
implementation changes were made during this test session. Tests ran outside the
tool sandbox so local Unix sockets and process fixtures were permitted.

## Measured results

| Command | Result | Elapsed | User CPU | System CPU |
| --- | --- | --- | --- | --- |
| `npm run check` | Passed | Not measured | Not measured | Not measured |
| `npm run test:quick` | 16 passed, no failures/skips | 0.62 s including build | 0.81 s | 0.14 s |
| `npm test` | 138 passed, 3 failed, no cancellations/skips | 748.54 s including build | 590.29 s | 142.11 s |

Timing used `/usr/bin/time -p`. Full-suite CPU time totals 732.40 seconds,
approximately 0.98 CPU cores averaged over elapsed time, not 98% of the entire
machine. Peak CPU, memory and energy were not measured. This is one local run,
not a stability sample or a hosted-run benchmark. Dependency installation had
passed in the preceding session; it was not repeated for this run.

## Failures

1. `test/coordinator.test.ts`: oversized candidate review expected a paused
   run's resume state to be `reviewing`, but it was `building`. The test did not
   reach its intended review-boundary assertion. The exact early-pause cause is
   not established by this output; capture its reason/private synthetic
   diagnostics on a focused rerun before changing behavior or expectations.
2. `test/coordinator.test.ts`: complete approval/build/merge/archive lifecycle
   failed in the fixture's `git update-ref`: the remote did not contain the
   candidate object. Investigate publication state and the synthetic merge
   sequence before attempting the fixture merge. This result does not prove
   production archival is broken; it leaves that integration path unverified.
3. `test/provenance.test.ts`: synthetic installation failed with
   `ERR_MODULE_NOT_FOUND` for `scripts/routing.mjs`. The fixture copies only
   `install.mjs` and `source-provenance.mjs`, omitting the installer's imported
   routing module. Repair the fixture's dependency closure, then rerun it;
   later assertions have not been reached.

## Robustness and efficiency

The socket failures from the earlier sandboxed attempt did not recur. Passing
checks include concurrent ownership, stale evidence rejection, cancellation,
same-process-group descendant termination, quota recovery with suite reuse,
and lost-push reconciliation without duplicate Auditor work. These are synthetic
checks, not native VM containment or live-provider acceptance.

Coordinator integration cases dominate runtime. The repair-feedback case took
93.17 seconds, publication approval 74.80 seconds, and partial archive recovery
73.06 seconds. Profile fixture creation and subprocess/Git activity before
changing concurrency. Keep timing-sensitive ownership tests isolated.

The test fixtures use fake model CLIs: this run did not need provider inference.
The assistant conversation consumes tokens separately. Live workflow usage still
has no hard token ceiling. Serial test files limit concurrency but do not impose
a CPU quota. The local full-suite command has no overall deadline; CI has a
ten-minute job deadline, which this Mac run exceeded. Hosted performance may
differ, so measure it before changing that limit.

Recommended order: repair and rerun the three affected fixtures with intact
assertions; add a reviewed overall test budget with descendant cleanup and
diagnostics; profile the slow integration paths; then run the full suite once
on the final candidate. Use quick and targeted tests between changes. Do not
claim release readiness from the quick suite or this failing full run.
