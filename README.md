# Aegean

Human-governed agentic software delivery, using OpenSpec, Claude Code and Codex.

**Status: bootstrap installed on the primary Mac; full workflow acceptance pending.**
See [current evidence and gaps](docs/STATUS.md).

The reusable implementation is on `bootstrap-v1` for human review. The secondary Mac,
live subscription role loop and real-project pilot have not passed acceptance.
`aegean doctor --json` reports these gates; installation alone does not enable
implementation runs.

Aegean is the default route for significant engineering changes. Simple,
low-risk operations retain a lightweight path. Specifications, protected tests,
implementation, verification and human decisions have distinct owners.

The intended loop is:

`request → spec → human approval → protected tests → build → verify/review → human merge`

One Builder, two repair attempts, subscription authentication only. Either Mac
can own a run; the secondary host is not a required server. Public developer tests remain
visible. Protected test source and expected results live outside Builder access.

- [Implementation plan](docs/PLAN.md)
- [Status and release gates](docs/STATUS.md)
- [Architecture and security](docs/ARCHITECTURE.md)
- [Installation and recovery](docs/OPERATIONS.md)

This repository is private pending an explicit publication decision. It contains
no history from the former personal-capture project, which is preserved privately
as `legacy-project`. Public demonstrations use synthetic data only.
