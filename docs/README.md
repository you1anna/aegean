# Documentation

[Overview](../README.md) · [Workflow](WORKFLOW.md) · [Architecture](ARCHITECTURE.md) · [Contribute](../CONTRIBUTING.md)

## Understand Aegean

| Guide | What it explains |
| --- | --- |
| [Workflow](WORKFLOW.md) | The stages, artifacts and human decisions. |
| [Architecture](ARCHITECTURE.md) | Components, agent context, test isolation and design trade-offs. |
| [Testing](TESTING.md) | Source checks and the evidence behind the controls. |
| [Status](STATUS.md) | Recorded results and open release gates. |

## Use Aegean

| Task | Guide |
| --- | --- |
| Install a reviewed release | [Installation](OPERATIONS.md#install-on-either-mac) |
| Inspect login and verifier readiness | [Host commands](OPERATIONS.md#host-commands) |
| Configure an eligible project | [Configuration files](OPERATIONS.md#configuration-files) |
| Prepare a request | [Project and request](OPERATIONS.md#prepare-the-project-and-the-request) |
| Draft and approve a specification | [Interactive guide](OPERATIONS.md#use-the-interactive-guide) |
| Verify and publish a candidate | [Verification and publication](OPERATIONS.md#verification-and-publication) |
| Inspect evidence or recover a run | [Run records](OPERATIONS.md#run-records-and-debugging) · [Recovery](OPERATIONS.md#recovery) |

## Supported use

- **Observed:** specification drafts reached human review in controlled trials.
- **Under evaluation:** complete delivery, including a real build, protected verification and publication.
- **Initial scope:** command-line changes on macOS. Implementation needs release acceptance or an authorised pilot with passing native prerequisites.

If Aegean is installed, inspect its release and readiness:

```sh
aegean info --json
aegean doctor --require prerequisites
```

Read `fullWorkflowReady` and each reported check. Use the operations guide reported by that installation.
A source checkout can describe changes that the installed release does not contain.

## Develop Aegean

Use [Contribute](../CONTRIBUTING.md) for source changes and documentation rules.
The [engineering reference](ENGINEERING.md) links to model policy, approved decisions and historical records.
