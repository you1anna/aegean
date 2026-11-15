# Aegean guides

[Overview](../README.md) · [The workflow](WORKFLOW.md) · [Contribute](../CONTRIBUTING.md)

Start with the result you need. Each guide explains one part of the path from
request to reviewed change.

| Your goal | Guide |
| --- | --- |
| Understand what each stage gives you | [The workflow](WORKFLOW.md) |
| Prepare an approved installation | [Installation](OPERATIONS.md#install-on-either-mac) |
| Take a request through its review steps | [Run lifecycle](OPERATIONS.md#run-lifecycle) |
| Inspect a run and its evidence | [Run records](OPERATIONS.md#run-records-and-debugging) |
| Recover interrupted work | [Recovery](OPERATIONS.md#recovery) |
| Improve the product or its documentation | [Contribute](../CONTRIBUTING.md) |

## Supported use

Controlled trials currently support specification drafting and review. Implementation
requires release acceptance; the complete delivery workflow remains under evaluation.
The initial adapter targets command-line changes on macOS.

Before installation or a run, read the [operating requirements](OPERATIONS.md).
If Aegean is already installed, inspect its readiness:

```sh
aegean doctor --json
```

Read `fullWorkflowReady` and each reported check. Use the operations guide path
in the result for that installed version. A source checkout can describe changes
that the installed release does not yet contain.

## Understand the design

The [engineering guide](ENGINEERING.md) links to architecture, technical decisions,
release evidence and trial records. These details support the user guides without
interrupting the main workflow.
