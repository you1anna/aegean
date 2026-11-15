# Engineering reference

[Overview](../README.md) · [Guides](README.md) · [Contribute](../CONTRIBUTING.md)

These records describe the implementation, test results and proposed changes.
For operating instructions, use the [guides](README.md).

## Source and installed versions

Source changes and installed releases have separate identities. A merge does not install a release or accept it for ordinary use.
PR #2 added the VM-contained Builder, separate execution permits, host-specific evidence, local decisions and model-use controls.
[Bounded CLI progress](BOUNDED-CLI-PROGRESS.md) records that work and its evidence.
The [operator command change](../openspec/changes/local-operator-commands/proposal.md) adds source tasks, host commands and controlled pilot preparation.

The operations guide describes this source version. Before a live action, use the guide reported by the installed release.
New releases expose `aegean info --json`; older releases report their guide through `aegean doctor --json`.

## Design and evidence

| Reference | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Roles, data ownership, module boundaries and trust boundaries. |
| [Model use](MODEL-USAGE.md) | Selection, context, token allowances and recovery limits. |
| [Testing](TESTING.md) | Focused checks, full-suite commands and fixture requirements. |
| [Current status](STATUS.md) | Dated results, installed versions and open release requirements. |
| [Acceptance contract](ACCEPTANCE.md) | Evidence required for an exact installed release. |
| [Accepted plan](PLAN.md) | Original scope and approved design decisions. |

## Proposals and trial records

These records preserve context. Proposals do not describe available features or
grant permission for a run.

| Record | Purpose |
| --- | --- |
| [Bounded CLI specification](BOUNDED-CLI-SPEC.md) | Scope for the implementation in PR #2; see its approval record below. |
| [Bounded CLI progress](BOUNDED-CLI-PROGRESS.md) | Approval record, source checks and remaining release requirements. |
| [Model selection and token budgets](../openspec/changes/task-model-selection-and-token-budgets/proposal.md) | Approved scope, design and implementation checklist. |
| [Operator command review](OPERATOR-COMMANDS-REVIEW.md) | Source findings, fixes and verification limits. |
| [Model policy review](MODEL-POLICY-REVIEW.md) | Independent findings, fixes and verification limits. |
| [Test report](TEST-REPORT-2026-11-13.md) | Recorded local and hosted results for the bounded CLI candidate. |
| [Pilot notes](PILOT-NOTES.md) | Real run outcomes and links to private evidence. |
| [Recovery checks](RECOVERY-CHECKS.md) | Scope and limits of synthetic coordinator tests. |
| [Bootstrap review](PR-1-REVIEW.md) | Findings from the first implementation review. |
| [Follow-up review](PR-1-FOLLOWUP-REVIEW.md) | Usability findings and proposed changes. |

## Record ownership

Keep each fact in one place, then link to it. Status owns dated evidence;
operations owns procedures and recovery; architecture owns design explanations.
The acceptance validator owns the evidence schema. Plans and reviews preserve
approved decisions and proposals with their original status.

The [documentation standard](../CONTRIBUTING.md#documentation) defines how each
pull request keeps the product overview and linked guides consistent.
