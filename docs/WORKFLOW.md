# Workflow

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Guides](README.md)

Each stage produces an artifact or a decision for the next stage.
The coordinator controls the sequence; agents cannot approve their own work.

| Stage | Who acts | Result |
| --- | --- | --- |
| Specify | Scout, then human | An approved OpenSpec contract and allowed paths. |
| Prepare tests | Test Auditor, then verifier | A protected suite and its results on the unchanged base commit. |
| Implement | Builder | A candidate commit within the approved scope. |
| Verify and review | Verifier, then a fresh Auditor call | Test evidence and findings against that candidate. |
| Publish | Human, then coordinator | Approval for the exact candidate, then a pull request. |
| Merge | Human | A separate decision to accept the change. |

## 1. Draft the specification

Describe the problem, expected behaviour and constraints. The Scout drafts the requirements, design and tasks.
It receives the request and [selected committed project files](OPERATIONS.md#prepare-the-project-and-the-request).

Read `review-notes.md` first. Resolve open questions and omitted requirements before approval.
Check that `allowed-paths.txt` includes each file the change needs.

## 2. Approve the scope

Your approval binds an exact specification revision. The Builder and test author use that same contract.
A later contract change needs new approval and new protected tests.

## 3. Build and check the code

This stage requires release acceptance or an authorised pilot with passing native prerequisites.
See [supported use](README.md#supported-use).

1. The test Auditor derives protected cases from the contract, without implementation context.
2. The verifier runs them on the base commit. If every case passes, the run stops before implementation.
3. The Builder changes the candidate through a restricted tool bridge.
4. The verifier checks allowed paths, public checks and protected cases.
5. A fresh Auditor call reviews the contract, candidate diff and public verification feedback.

| Finding owner | Next step |
| --- | --- |
| Builder | Repair within the contract, subject to the repair limit. |
| Specification | Stop for a corrected request and a new run. |
| Aegean | Stop for a fix to Aegean before a new run. |

The [isolation diagram](ARCHITECTURE.md#protected-verification) shows what stays private during these checks.

## 4. Review and publish

Inspect the diff, test results and findings. Your publication approval binds the exact candidate and its evidence.
Aegean then pushes the candidate. You decide separately whether to merge the pull request. Aegean never merges it.

## Run the workflow

Use [the interactive guide](OPERATIONS.md#use-the-interactive-guide) through specification approval.
Use [the operating instructions](OPERATIONS.md#verification-and-publication) for verification, publication and revisions.
