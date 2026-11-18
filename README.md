# Aegean

Aegean coordinates Claude Code and Codex to turn an approved specification into a verified software change.

The Builder cannot read the protected acceptance tests. A separate verifier checks the candidate against them.
You approve the scope, approve publication and decide whether to merge.

[Workflow](docs/WORKFLOW.md) · [Architecture](docs/ARCHITECTURE.md) · [Guides](docs/README.md) · [Contribute](CONTRIBUTING.md)

![A translucent ribbon forms an A above a calm Aegean sea at dusk.](docs/images/aegean.png)

> **Experimental.** Specification drafts have reached human review in controlled trials.
> Full delivery still requires release acceptance or an authorised pilot. See [status and evidence](docs/STATUS.md).

## How it works

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "-apple-system, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "15px", "lineColor": "#56749a"}, "flowchart": {"curve": "basis", "nodeSpacing": 40, "rankSpacing": 48, "padding": 18}}}%%
flowchart LR
    accTitle: Aegean delivery workflow
    accDescr: The Scout drafts a specification. A human approves it. The Builder implements it, protected tests and a fresh review check it, then a human approves publication and decides on merge.
    S("<b>Specify</b><br/><small>Scout + human approval</small>") --> B("<b>Build</b><br/><small>Codex Builder</small>")
    B --> V("<b>Check</b><br/><small>Verifier + fresh review</small>")
    V --> H(["<b>Review</b><br/><small>Human publication + merge</small>"])
    classDef agent fill:#e8eff8,stroke:#56749a,color:#182d49,stroke-width:1.5px
    classDef gate fill:#fce8d8,stroke:#ae7044,color:#442b1b,stroke-width:2px
    class S,B,V agent
    class H gate
    linkStyle default stroke:#56749a,stroke-width:2px
```

- **Approve one contract.** OpenSpec records the requirements, allowed paths and implementation plan.
- **Check independently.** The test author receives the contract without the implementation. The verifier checks the base commit before the candidate.
- **Keep evidence current.** A changed contract or candidate invalidates its earlier approval or verification.

The [architecture](docs/ARCHITECTURE.md) explains the components, isolation and design trade-offs.

## Start here

For an approved installation, follow the [installation guide](docs/OPERATIONS.md#install-on-either-mac).
Then [prepare the project and request](docs/OPERATIONS.md#prepare-the-project-and-the-request).

In the enrolled project, start the interactive guide:

```sh
aegean guide
```

The guide covers host checks, the request and specification review. See the [workflow](docs/WORKFLOW.md) for later stages.

| Read next | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Understand the design and its limits. |
| [Operations](docs/OPERATIONS.md) | Install, run, inspect and recover. |
| [Testing](docs/TESTING.md) | Run source checks and find the evidence for each control. |
| [Engineering reference](docs/ENGINEERING.md) | Find decisions, release gates and trial records. |

The first adapter supports command-line changes on macOS with subscription CLI accounts.
This repository is private and has no software licence.
