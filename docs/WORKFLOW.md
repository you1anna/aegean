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

The verifier runs the tests and records the results. The Auditor reviews the
candidate code in a fresh context. Repair attempts have a fixed limit.

This stage requires release acceptance or an authorised pilot with passing native prerequisites. Full delivery remains under evaluation;
see [supported use](README.md#supported-use) before a run.

## 4. Review and publish

Inspect the code diff, test results and review findings. Approve publication only
when you are satisfied with the change. Aegean checks that approval before the push.

You then decide whether to merge the pull request. Aegean never supplies your
approval or merges on your behalf.

## Operating instructions

For commands, approval steps and recovery, use the [operations guide](OPERATIONS.md).
For roles and trust boundaries, read the [architecture](ARCHITECTURE.md).
