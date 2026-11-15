# Documentation

[Aegean](../README.md) coordinates AI-assisted software delivery with human
approval and independent checks. It remains experimental.

## Choose a guide

| I want to… | Read |
| --- | --- |
| Understand the purpose and workflow | [Project overview](../README.md) |
| See what works and what remains unproven | [Current status](STATUS.md) |
| Install, configure or operate an approved trial | [Operations](OPERATIONS.md) |
| Understand roles, data and trust boundaries | [Architecture](ARCHITECTURE.md) |
| Change the source or improve the docs | [Contribute](../CONTRIBUTING.md) |
| Review the evidence required for release | [Acceptance contract](ACCEPTANCE.md) |

Start with status before a trial. There is no general quickstart while the full
workflow remains unaccepted.

## Plans and trial records

These records explain decisions and evidence. They do not replace the operating
instructions or grant approval for a run.

| Record | Purpose |
| --- | --- |
| [Accepted plan](PLAN.md) | Original scope and approved design decisions. |
| [Proposed CLI pilot](BOUNDED-CLI-SPEC.md) | Draft of the next milestone; not implemented. |
| [Pilot notes](PILOT-NOTES.md) | Short records of real runs and links to private evidence. |
| [Recovery checks](RECOVERY-CHECKS.md) | Scope and limits of the coordinator's synthetic tests. |
| [Bootstrap review](PR-1-REVIEW.md) | Findings from the first implementation review. |
| [Follow-up review](PR-1-FOLLOWUP-REVIEW.md) | Usability findings and proposed changes. |

## Keep the docs simple

The [contributor guide](../CONTRIBUTING.md#documentation) owns the writing guidance.
Give each fact one home, then link to it:

- **Status** owns dated results and open release requirements.
- **Operations** owns procedures, run records and recovery.
- **Architecture** owns explanations of roles and boundaries.
- **Acceptance** explains the evidence contract and links to its schema in code.
- **Plans and reviews** preserve decisions and proposals with their original status.

The source checkout and installed release can differ. Use the operations guide
path from `aegean doctor --json` for the installed version. Read this checkout's
guides when you review a proposed change.
