# Low-cost testing

For repeated local feedback, run `npm run test:quick`. It builds the current
source and runs only the pure workflow tests, serially, with a ten-second
timeout per test. These tests exercise approvals, stale evidence, idempotence,
repair/revision budgets and active-time exhaustion without launching model CLIs,
Docker, or a verifier VM. Compilation is outside that test timeout.

Use `nice -n 10 npm run test:quick` to give other local work scheduling priority.
This reduces contention; it is not a CPU percentage or energy cap. Run one test
command at a time and avoid watch loops. The quick command shares the normal
build output, so do not run it alongside another build or test command.
Some sandboxes reject `nice` with `setpriority: Operation not permitted`; in that
case no priority reduction has been applied. Bridge tests also require permission
to open local Unix sockets. An `EPERM` socket failure is not a passing check;
rerun those tests in a suitable environment instead of repeatedly retrying them.

Build once with `npm run build`, then select the compiled file and, for expensive
integration cases, the specific test name:

```sh
node --test --test-concurrency=1 --test-timeout=300000 \
  --test-name-pattern='lost suite-push acknowledgement' dist/test/coordinator.test.js
```

Inspect that test's dependencies before assuming it is offline. Do not add live
provider calls to the quick workflow test file.

Before accepting a candidate, run `npm ci`, `npm run check` and `npm test`.
Quick checks are partial feedback, not full-suite or native acceptance evidence.
Keep the full suite and CI checks intact; avoid repeatedly running the full suite
against an unchanged candidate. Record the command, exit status and duration.
On failure, inspect and rerun the affected test rather than automatically retrying
the whole suite. Ctrl-C stops a local quick check; it holds no workflow lease or
VM resources, and rebuilding is its recovery path.

The full suite runs one file at a time and limits individual tests to five
minutes. CI also has a ten-minute job deadline. Local runs have no aggregate
deadline. Fixture subprocesses keep their own timeouts and cleanup logic.
Coordinator fixtures use isolated temporary state and real local Git repositories.
The Git shim calls Git directly for routine operations and keeps the synthetic
origin check and push fault injection. Compare elapsed time and CPU time with
`/usr/bin/time -p npm test` when evaluating changes to the full suite.

Live Aegean runs consume subscription usage separately from deterministic tests.
Current policy limits are owned by `toolchain.json`; they bound active time and
retries, not token consumption. Provider usage can be unknown, and time limits
are not hard token caps. No model is needed to poll status. Use `aegean cancel`
for an active workflow rather than killing its coordinator or deleting its lease.
Installed releases can differ from this checkout; check `aegean doctor --json`
and the installed operations guide before any live exercise. Existing release
gates remain required. Changing runtime budgets requires the normal reviewed
policy/release process; editing the checkout does not update an installation.
