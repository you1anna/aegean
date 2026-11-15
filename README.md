# Aegean

**Clarity at every step of AI-assisted software delivery.**

Aegean coordinates OpenSpec, Claude Code and Codex around a change you approve.
It separates the specification, code and independent checks, with human decisions
before implementation, publication and merge.

[Documentation](docs/README.md) · [Current status](docs/STATUS.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Contribute](CONTRIBUTING.md)

> **Experimental.** Aegean is under active trial. The full workflow is not yet
> accepted for ordinary use. Read the [tested behaviour and open release
> requirements](docs/STATUS.md) before installation or a trial.

![A translucent ribbon forms an A above a calm Aegean sea at dusk.](docs/images/aegean.png)

## Why Aegean

Software delivery can be complex. The process should remain clear.

Aegean's aim is beauty in simplicity: a clear request, visible evidence and
deliberate decisions. Each step has one purpose. Each fact has one owner.
You should be able to see what changed, why it changed and what still needs proof.

## How it works

1. **Describe the change.** The Scout drafts an OpenSpec specification.
2. **Approve the scope.** You review the specification before implementation.
3. **Build and check.** An independent Auditor creates protected tests. The
   Builder writes code, then the verifier checks it and the Auditor reviews it.
4. **Review the result.** You approve the candidate before Aegean pushes it.
   You decide whether to merge.

Claude Code supplies the Scout and Auditor; Codex supplies the Builder.
The coordinator controls state, credentials and approvals. Models do not approve
their own work. A passing test suite does not replace human review.

The initial scope is small command-line changes on macOS. Aegean uses subscription
CLI accounts, with one Builder at a time and bounded repair attempts.
See the [architecture](docs/ARCHITECTURE.md) for the boundaries and current limits.

## Start here

- **Understand the project:** read the [documentation map](docs/README.md).
- **Assess a trial:** read the [current status](docs/STATUS.md), then the
  [installation and operations guide](docs/OPERATIONS.md).
- **Work on the source:** follow the [contributor guide](CONTRIBUTING.md).

If Aegean is already installed, inspect its readiness:

```sh
aegean doctor --json
```

Read `fullWorkflowReady` and each reported check. Installation alone does not
mean the workflow is ready. The [operations guide](docs/OPERATIONS.md) explains
the requirements and recovery steps.

## Project status

This repository remains private and has no software licence.
Public release requires a separate decision. The [accepted plan](docs/PLAN.md) records
the original scope. The [next milestone](docs/BOUNDED-CLI-SPEC.md) is a draft,
not an implemented feature list.
