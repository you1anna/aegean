# Engineering reference

[Overview](../README.md) · [Guides](README.md) · [Contribute](../CONTRIBUTING.md)

Use these records to understand the design, assess evidence or review a proposed
change. For the product workflow and operating steps, start with the [guides](README.md).

## Design and evidence

| Reference | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Roles, data ownership, module boundaries and trust boundaries. |
| [Current status](STATUS.md) | Dated results, installed versions and open release requirements. |
| [Acceptance contract](ACCEPTANCE.md) | Evidence required for an exact installed release. |
| [Accepted plan](PLAN.md) | Original scope and approved design decisions. |

## Proposals and trial records

These records preserve context. Proposals do not describe available features or
grant permission for a run.

| Record | Purpose |
| --- | --- |
| [Proposed CLI pilot](BOUNDED-CLI-SPEC.md) | Draft of the next milestone. |
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
