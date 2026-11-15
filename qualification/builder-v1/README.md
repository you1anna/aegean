# Builder qualification fixtures

These ten synthetic tasks support the [approved trial plan](../../openspec/changes/task-model-selection-and-token-budgets/qualification.md).
They are not evidence of model quality. No live model has attempted them.

Each directory contains a complete public requirement and an unfinished `app.cjs`.
The starter intentionally exits 1. Each arm must use a fresh copy, not another arm's candidate.
The [manifest](manifest.json) binds requirements, starter source and protected suites with SHA-256 hashes.
The [schedule](schedule.json) fixes all 60 arms, their order and individual limits.

Protected cases, reference implementations and seeded defects remain outside Git and candidate access.
Their private manifest hash is `fc2417e1e7d4aa9c5cbab3d3e95743a45e7c97c64163b58b1969e3b00f1278f3`.
The private package has ten suites and 56 cases. All reference programs passed those cases.
Every seeded defect and every unfinished starter failed at least one case.
These checks used local Node processes, not the native protected verifier.
The private package retains `check.py` and `offline-results.json` for repeatable integrity and defect checks.

## Execution package

Use [the execution record](EXECUTION.md) for the live scope, evidence requirements and outstanding prerequisites.
Do not execute a live call from this directory. Public fixture preparation grants no subscription or installation approval.

The source-tree hash covers the two file hashes as sorted, compact JSON with keys `app.cjs` and `requirements.md`.
No other files belong in the initial candidate snapshot.

## Preparation checks

Locked dependency installation and type checking passed. The full synthetic regression suite passed 175 tests, with no failures or skips, in 629.89 seconds.
Manifest integrity, paired order, budget totals, package links and strict OpenSpec validation passed.
No model call, native verifier run or installation formed part of these checks.
