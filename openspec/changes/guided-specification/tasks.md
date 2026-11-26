# Tasks

This checklist does not grant implementation, release or pilot approval. Each phase is one pull request.
Run `npm ci`, `npm run check` and `npm test` with the pinned Node runtime before each pull request.

## 0. Approval and baseline

- [x] 0.1 Record the operator decisions in [design](design.md#open-decisions-for-the-operator).
- [ ] 0.2 If the operator chooses the canary first, run it and record the baseline measures in `docs/PILOT-NOTES.md`.

## 1. One page to review

- [ ] 1.1 Add the `scope` field to the draft schema, with a limit of 600 characters. Test a missing field and a long field.
- [ ] 1.2 Build the requirement names, their first sentences and the allowed paths from the draft.
  Test that the page agrees with the contract. Test a requirement without a statement.
- [ ] 1.3 Keep `parseReviewNotes` the exact inverse of `reviewNotes`. Extend the round-trip tests for each new section.
- [ ] 1.4 Add the writing rules to the Scout prompt. Test that the prompt holds each rule and no private path.
- [ ] 1.5 Show the summary page first at `spec-drafted`. Say what the approval covers. Test the guide text with a scripted UI.
- [ ] 1.6 Change the policy version to `0.9.0`. Test that a `0.8.0` run is cancel-only.

## 2. Guided request

- [ ] 2.1 Ask one question for each request section in the guide. Test empty, long and cancelled answers.
- [ ] 2.2 Show the request and ask for a confirmation before `prepare`. Test that `prepare` gets the exact text.

## 3. Questions before the draft

- [ ] 3.1 Add the clarify prompt and its output schema in `src/domain/scout.ts`. Test valid, empty, too many and malformed outputs.
- [ ] 3.2 Add the clarify call through the existing admission control and role adapter. Test that a refused admission makes no process start.
- [ ] 3.3 Ask each question in the guide. Write `clarifications.md` atomically. Test interruption after the call and after each answer.
- [ ] 3.4 Bind the question and answer digests to the draft and show them at approval. Test a changed answer file.
- [ ] 3.5 Let the operator skip the clarification. Test that a skip makes no model call.
- [ ] 3.6 Change the minimum model calls in the guide limits from 4 to 5. Test the limits questions.

## 4. Answers at the review

- [ ] 4.1 Ask each open question with the recommendation first. Write the answers to `review-notes.md`. Test each choice.
- [ ] 4.2 Offer one redraft when an answer differs or a need is not covered. Test the limit of one redraft for each run.
- [ ] 4.3 Test that a redraft clears later evidence and needs a new approval.

## 5. Documentation and pilot

- [ ] 5.1 Update `docs/WORKFLOW.md`, `docs/OPERATIONS.md` and the guide help. Check the links.
- [ ] 5.2 Record source checks in `docs/STATUS.md`. Do not claim live behaviour from synthetic tests.
- [ ] 5.3 With the operator's approval, install the release and run `aegean qualify`.
- [ ] 5.4 Run one pilot request. Record the measures from [design](design.md#measures-of-success) in `docs/PILOT-NOTES.md`.
