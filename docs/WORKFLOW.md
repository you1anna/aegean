# Workflow

[Overview](../README.md) · [Guides](README.md)

Aegean separates specification, implementation and verification. You approve the
scope before implementation and review the code and test results before publication.

## 1. Draft the specification

Describe the problem, the expected behaviour and the constraints. The Scout uses
Claude Code to draft an OpenSpec specification with requirements and success criteria.

The Scout reads the request, the project checks and a fixed set of committed project files.
It cannot read other files on your computer. The operations guide lists
[what the Scout reads](OPERATIONS.md#prepare-the-project-and-the-request).

Review the specification before implementation. Resolve missing requirements or
unwanted changes at this stage. Start with the review notes in the draft: they list the
project rules that limited the request, the open questions and each need that the draft omits.

## 2. Approve the scope

Request revisions where needed. Your approval identifies an exact specification
revision, so implementation and tests refer to the same requirements.

## 3. Build and check the code

The Auditor uses Claude Code to prepare protected tests from the approved
specification. The Builder uses Codex to write code in an isolated worktree.

Before the Builder starts, the verifier runs the tests on the unchanged code. A test that
already passes there cannot show that the change works; if every test passes, the run stops.
The approved specification also lists the paths that the Builder may change.

The verifier then checks the changed paths, runs the tests on the candidate and records the
results. The Auditor reviews the candidate code in a fresh context and gives each finding an owner.
A code defect goes back to the Builder; repair attempts have a fixed limit. A fault in the
specification or in Aegean stops the run for you, with no repair.

This stage requires release acceptance or an authorised pilot with passing native prerequisites. Full delivery remains under evaluation;
see [supported use](README.md#supported-use) before a run.

## 4. Review and publish

Inspect the code diff, test results and review findings. Approve publication only
when you are satisfied with the change. Aegean checks that approval before the push.

You then decide whether to merge the pull request. Aegean never supplies your
approval or merges on your behalf.

## Operating instructions

For the first two stages, `aegean guide` asks a question for each step; see the [interactive guide](OPERATIONS.md#use-the-interactive-guide).
For commands, approval steps and recovery, use the [operations guide](OPERATIONS.md).
For roles and trust boundaries, read the [architecture](ARCHITECTURE.md).
