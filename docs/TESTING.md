# Testing

[Contribute](../CONTRIBUTING.md) · [Architecture](ARCHITECTURE.md) · [Status](STATUS.md)

Aegean has two distinct test concerns:

| Concern | Purpose | Evidence limit |
| --- | --- | --- |
| Source tests in this repository | Check coordinator rules, adapters, races and recovery with synthetic fixtures. | Do not establish live model quality or native VM containment. |
| Protected acceptance tests for a change | Check a candidate against its approved contract. | A passing suite proves only the cases it contains. |

[Architecture](ARCHITECTURE.md#protected-verification) explains how protected cases stay outside the Builder and candidate container.
[Release acceptance](ACCEPTANCE.md) defines the separate host and live-run evidence.

## Check a change

Use the pinned Node runtime from [toolchain.json](../toolchain.json).
The [source commands](../CONTRIBUTING.md#check-the-source) install and select it through mise.

Before a PR, run:

```sh
npm ci
npm run check
npm test
```

The full suite runs TypeScript tests one file at a time, then script tests.
Each TypeScript test has a five-minute limit. [CI](../.github/workflows/checks.yml) owns the job deadline; local runs have no aggregate deadline.
Fixtures have their own subprocess limits and cleanup.

Record the commands, exit status and duration. If a test fails, inspect and repeat the affected check before another full run.
Do not repeat a passing full suite against unchanged source without a reason.

## What the tests cover

| Control | Test evidence |
| --- | --- |
| Approval, stale evidence, repair budgets and repeated events; the states that accept each event and the evidence that each event clears | [Workflow](../test/workflow.test.ts). |
| Base commit results, allowed paths and finding owners | [Build checks](../test/build-checks.test.ts) and [coordinator](../test/coordinator.test.ts). |
| Protected values stay out of receipts and repair feedback | [Verifier](../test/verifier.test.ts). |
| Candidate mounts exclude tests and host credentials | [Adapter arguments](../test/adapters.test.ts); native enforcement needs host qualification. |
| Fresh role calls and bounded context | [Model context](../test/model-context.test.ts) and [coordinator](../test/coordinator.test.ts). |
| Concurrent ownership and stale owner rejection | [Ledger permits](../test/ledger-permits.test.ts) and [ownership recovery](../test/ownership.test.ts). |
| Interrupted effects, imports and publication | [Coordinator](../test/coordinator.test.ts), [Builder import](../test/builder-import.test.ts) and [process recovery](../test/process-recovery.test.ts). |
| Git hooks, filters and configuration isolation | [Git safety](../test/git-safety.test.ts). |
| Layer import rules and import cycles | [Architecture](../test/architecture.test.ts). |
| Release installation | [Installation](../test/installation.test.ts). |
| Host, release and policy identities invalidate old evidence | [Acceptance](../test/acceptance.test.ts). |

## Fast local feedback

Run only the pure workflow tests after a small rule change:

```sh
npm run test:quick
```

This command builds the source and applies a ten-second limit per test. Compilation sits outside that limit.
It uses no model CLI, Docker or verifier VM. Do not add live provider calls to this test file.

For one integration case, build once and select the test:

```sh
npm run build
node --test --test-concurrency=1 --test-timeout=300000 \
  --test-name-pattern='lost suite-push acknowledgement' dist/test/coordinator.test.js
```

Inspect the selected test's dependencies before assuming it is offline.
Quick or focused checks do not replace the full suite or native acceptance.

## Fixture isolation and recovery

- Run one build or test command at a time. Quick checks share the normal build output.
- Use synthetic data, temporary state and local Git repositories. Keep live credentials, private suites and run records outside Git.
- Bridge tests need local Unix sockets. An `EPERM` socket error is a failed check; repeat it in a suitable environment.
- Ctrl-C stops a quick check. It holds no workflow lease or VM resources; rebuild before the next check.
- Bootstrap checks provenance, types, scripts and artifacts. It does not repeat the development suite.

Use `nice -n 10 npm run test:quick` to reduce scheduling priority when supported.
This is not a CPU or energy cap. An `Operation not permitted` error means no priority reduction occurred.
Use `/usr/bin/time -p npm test` to compare elapsed and CPU time when a test change affects capacity.

### Git configuration in fixtures

Builder-import and routing fixtures use [`test/helpers/git-config.ts`](../test/helpers/git-config.ts) to exclude user and system Git configuration.
The helper restores the environment after each file. Use it only with serial files and Node's default process isolation.
Repository-local configuration stays visible to the production safety checks.

To reproduce a host with Git LFS, create a temporary configuration with `[filter "lfs"]` and `clean = git-lfs clean -- %f`.
Then run:

```sh
GIT_CONFIG_GLOBAL=/path/to/temporary.gitconfig node --test \
  --test-concurrency=1 --test-timeout=300000 \
  dist/test/builder-import.test.js dist/test/installation.test.js dist/test/git-safety.test.js
```

Filter, hook and configuration-include rejection tests must still pass.
The coordinator's Git shim preserves synthetic origin checks and push fault injection.

## Live trials

Live trials consume subscription usage and require separate approval.
Use [operations](OPERATIONS.md) for the installed release's gates, records and cancellation procedure.
[Model use](MODEL-USAGE.md) describes monitored allowances; time limits are not strict token caps.
A source edit does not update an installation or its acceptance evidence.
