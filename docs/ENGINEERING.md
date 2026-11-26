# Engineering reference

[Overview](../README.md) · [Guides](README.md) · [Contribute](../CONTRIBUTING.md)

## Design and evidence

| Reference | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Components, isolation, ownership and design trade-offs. |
| [Testing](TESTING.md) | Commands and a map from controls to tests. |
| [Model use](MODEL-USAGE.md) | Model selection, context limits and token accounting. |
| [Current status](STATUS.md) | Dated results and open release gates. |
| [Acceptance contract](ACCEPTANCE.md) | Evidence required for an exact installed release. |
| [Accepted plan](PLAN.md) | Original scope and approved decisions. |
| [Pull-request archive](history/pull-requests/README.md) | The record of each pull request from the earlier private repository. |
| [Commit map](history/commit-map.md) | Find a commit hash that an older document quotes. |

## Source and installed versions

A merge changes source. It does not install a release or establish readiness.

| Identity | Where to check |
| --- | --- |
| Source revision | The Git commit under review. |
| Installed release and tools | `aegean info --json`. |
| Host prerequisites and full acceptance | `aegean doctor --json`. |

For live operations, use the guide path reported by the installed release.
Older releases report that path through `doctor`.

## Proposals and trial records

These records retain their original dates and approval status. A proposal does not authorise execution.

| Record | Purpose |
| --- | --- |
| [Bounded CLI specification](BOUNDED-CLI-SPEC.md) | Scope for the VM boundary and local approval workflow. |
| [Bounded CLI progress](BOUNDED-CLI-PROGRESS.md) | Approval record, source evidence and open release gates. |
| [Model selection and token budgets](../openspec/changes/task-model-selection-and-token-budgets/proposal.md) | Approved scope and implementation plan. |
| [Local operator commands](../openspec/changes/local-operator-commands/proposal.md) | Approved scope for source, host and pilot commands. |
| [Guided specification](../openspec/changes/guided-specification/proposal.md) | Proposed scope: a one-page review, guided questions and plain technical English. Not approved. |
| [Operator command review](OPERATOR-COMMANDS-REVIEW.md) | Findings, fixes and verification limits. |
| [Model policy review](MODEL-POLICY-REVIEW.md) | Findings, fixes and verification limits. |
| [Test report](TEST-REPORT-2026-11-13.md) | Recorded local and hosted checks. |
| [Pilot notes](PILOT-NOTES.md) | Real run outcomes and private evidence locations. |
| [Recovery checks](RECOVERY-CHECKS.md) | Scope of the synthetic recovery tests. |
| [Bootstrap review](PR-1-REVIEW.md) · [Follow-up review](PR-1-FOLLOWUP-REVIEW.md) | Early findings and proposed changes. |

## Record ownership

| Concern | Owner |
| --- | --- |
| Design and trade-offs | Architecture. |
| Procedures and recovery | Operations. |
| Dated observations | Status and the linked run records. |
| Evidence schema | The acceptance validator. |
| Approved intent | Plans and specifications. |

Link to the owner instead of copying its facts. Follow the [documentation standard](../CONTRIBUTING.md#documentation) in each pull request.
