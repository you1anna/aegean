# Proposal: guided specification

Status: **proposed, not approved.** This proposal does not authorise implementation, installation or model calls.

## Why

The specification review is the slowest human step, and it is too much work. Pilot evidence:

- `trial-05`: the draft had 49 KB in six files. The contract had 5,024 words, 16 requirements and 41 scenarios.
  The review notes had 26 list items. The authorisation expired 19 minutes into the review.
- `trial-03`: the draft had 4 open questions and 3 needs that it did not cover. The operator had to correct the files by hand.

Two causes are clear. The human must read the full contract, and the human must resolve unclear scope by editing files.
The contract must stay exact, because the hidden test writer and the Builder use it. So the change must reduce what the
human reads, not the detail that the machine roles need.

## What changes

1. **One page to review.** `review-notes.md` becomes the summary page. It gives a short scope, each requirement name with its first sentence,
   the allowed paths, the open questions, the needs that the draft does not cover and the verification. Code builds
   most of the page from the draft, so the page cannot disagree with the contract.
2. **Plain technical English.** The Scout prompt gets a short set of writing rules. The Scout must not repeat the
   requirements in `proposal.md`, `design.md` or `tasks.md`.
3. **A guided request.** The guide asks short questions for the goal, the limits and the tests of success. It writes
   the request file from the answers. The operator can still use an editor or a request file.
4. **Questions before the draft.** If the scope is not clear, the Scout asks up to five questions before it drafts.
   Each question has options and one recommendation. The guide asks them one at a time. This uses one more model call.
5. **Answers at the review.** The guide shows each open question with the Scout recommendation. The operator accepts
   it or gives another answer. If an answer changes the scope, the guide offers one redraft with the answers.

## Out of scope

- No change to the contract format that the test writer and the Builder read.
- No change to the approval rule: an approval binds the full specification revision.
- No automatic approval, no background model calls and no new scheduler.
- No change to the stages after the specification approval.

## Impact

- Source: `src/domain/scout.ts`, `src/domain/guide.ts`, `src/application/guide.ts`, the run stages, the run events and tests.
- Policy: the Scout context changes, so the policy version changes from `0.8.0` to `0.9.0`.
  A run from policy `0.8.0` can then only be cancelled. Each host needs a new installation and `aegean qualify`.
- Model calls: a run with clarification uses one more Scout call. A redraft uses one more Scout call.
- Documentation: `docs/WORKFLOW.md`, `docs/OPERATIONS.md`, `docs/STATUS.md` and the guide text.

[Design](design.md) gives the decisions. [Tasks](tasks.md) gives the steps. The [requirements](specs/guided-specification/spec.md) give the testable behaviour.
