# Aegean guides

[Overview](../README.md) · [Workflow](WORKFLOW.md) · [Contribute](../CONTRIBUTING.md)

| Task | Guide |
| --- | --- |
| Understand the roles and review steps | [Workflow](WORKFLOW.md) |
| Prepare an approved installation | [Installation](OPERATIONS.md#install-on-either-mac) |
| Inspect authentication and the verifier | [Host commands](OPERATIONS.md#host-commands) |
| Check project configuration | [Configuration files](OPERATIONS.md#configuration-files) |
| Start and review a run | [Run lifecycle](OPERATIONS.md#run-lifecycle) |
| Inspect a run and its evidence | [Run records](OPERATIONS.md#run-records-and-debugging) |
| Recover interrupted work | [Recovery](OPERATIONS.md#recovery) |
| Change the code or documentation | [Contribute](../CONTRIBUTING.md) |

## Supported use

Controlled trials currently support specification drafting and review. Implementation
requires release acceptance or an authorised pilot with passing native prerequisites.
The complete delivery workflow remains under evaluation.
The initial adapter targets command-line changes on macOS.

Before installation or a run, read the [operating requirements](OPERATIONS.md).
If Aegean is already installed, inspect its readiness:

```sh
aegean info --json
aegean doctor --require prerequisites
```

Read `fullWorkflowReady` and each reported check. Use the operations guide path
in the result for that installed version. A source checkout can describe changes
that the installed release does not yet contain.

## Technical reference

The [engineering guide](ENGINEERING.md) links to architecture, technical decisions,
release evidence and trial records.
