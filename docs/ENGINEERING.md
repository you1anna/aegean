# Engineering reference

[Overview](../README.md) · [Guides](README.md) · [Contribute](../CONTRIBUTING.md)

These records describe the implementation, test results and proposed changes.
For operating instructions, use the [guides](README.md).

## Source and installed versions

The installed bootstrap and the source in PR #2 differ. The branch adds a
VM-contained Builder, separate execution permits, host-specific evidence and explicit routing activation.
The source includes scoped pilot authorisation, local decisions and model-use controls. Live qualification remains pending.
[Bounded CLI progress](BOUNDED-CLI-PROGRESS.md) records that work and its evidence.

The operations guide labels bootstrap procedures. Before any live action, use
`aegean doctor --json` and the guide for the installed release.

## Design and evidence

| Reference | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Roles, data ownership, module boundaries and trust boundaries. |
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
| [Bounded CLI progress](BOUNDED-CLI-PROGRESS.md) | Approval record, implemented foundations and remaining integration work. |
| [Model use](MODEL-USAGE.md) | Selection, context, token allowances and recovery limits. |
| [Model selection and token budgets](../openspec/changes/task-model-selection-and-token-budgets/proposal.md) | Approved scope, design and implementation checklist. |
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
