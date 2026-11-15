# Aegean

Aegean coordinates Claude Code and Codex to draft specifications, write code and
check software changes. It uses OpenSpec to record the requirements.

You approve the specification before implementation and the code before publication.
You decide whether to merge the pull request.

[Workflow](docs/WORKFLOW.md) · [Guides](docs/README.md) · [Contribute](CONTRIBUTING.md)

![A translucent ribbon forms an A above a calm Aegean sea at dusk.](docs/images/aegean.png)

## How it works

1. **Specify.** The Scout drafts the requirements from your request. You review
   and approve the scope before code changes begin.
2. **Build.** The Builder writes code in an isolated worktree against the approved
   specification.
3. **Check.** A separate Auditor creates protected tests and reviews the code.
   The verifier runs the tests and records the results.
4. **Review.** You inspect the code diff and results, approve the push and decide
   whether to merge.

See the [workflow guide](docs/WORKFLOW.md) for the roles and review steps.

## Use Aegean

Aegean currently supports specification drafting and review in controlled trials.
Full delivery remains under evaluation and requires release acceptance.
Start with the [guides](docs/README.md) for supported use and operating instructions.

The initial scope is command-line changes on macOS with subscription CLI accounts.
See [engineering details](docs/ENGINEERING.md) for architecture, decisions and evidence.

This repository remains private and has no software licence.
