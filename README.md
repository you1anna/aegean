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
    accDescr: The Scout in Claude Code drafts an OpenSpec contract. A human approves it. The Codex Builder implements it in a Git worktree on a dedicated VM. The verifier runs the protected suite in a Docker container with no network, and a fresh review checks the diff. A human then approves publication of a GitHub pull request and decides on merge.
    S("<b>Specify</b><br/>Scout +<br/>human approval<br/><br/>Claude Code<br/>OpenSpec contract")
    B("<b>Build</b><br/>Codex<br/>Builder<br/><br/>Git worktree<br/>dedicated VM")
    V("<b>Check</b><br/>Verifier +<br/>fresh review<br/><br/>Docker, no network<br/>protected suite")
    H("<b>Review</b><br/>Human publication<br/>+ merge<br/><br/>GitHub<br/>pull request")
    S --> B --> V --> H
    classDef agent fill:#e8eff8,stroke:#56749a,color:#182d49,stroke-width:1.5px
    classDef gate fill:#fce8d8,stroke:#ae7044,color:#442b1b,stroke-width:2.5px
    class S,B,V agent
    class H gate
    linkStyle 0,1,2 stroke:#56749a,stroke-width:2px
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

![The aegean guide start screen. It shows the Aegean logo, the guide introduction and the aegean doctor host check. All host checks pass, and the last line states that this release is not accepted.](docs/images/aegean-guide.png)

The guide covers the host check, the project check, the request, the pilot authorisation and the specification review.
It shows each command before it runs it. See the [workflow](docs/WORKFLOW.md) for later stages.

| Read next | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Understand the design and its limits. |
| [Operations](docs/OPERATIONS.md) | Install, run, inspect and recover. |
| [Testing](docs/TESTING.md) | Run source checks and find the evidence for each control. |
| [Engineering reference](docs/ENGINEERING.md) | Find decisions, release gates and trial records. |

The first adapter supports command-line changes on macOS with subscription CLI accounts.
Aegean is available under the [MIT licence](LICENSE). To report a security problem, read the [security policy](SECURITY.md).
