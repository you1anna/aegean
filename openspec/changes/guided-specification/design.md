# Design: guided specification

## Context

Measured on `trial-05` (local run records, outside Git). The contract file was 32,923 bytes and 5,024 words.
At a normal reading speed of about 250 words each minute, the contract alone needs about 20 minutes.
The full draft was 49 KB. The six files repeat some content; the amount of repetition is not measured.

The guide already reads the review notes, lists the open questions and lets the operator read each file.
The `draft` event already accepts a new draft in the `spec-drafted` state, and it clears later evidence.
So a redraft needs no new run state.

## Decisions

### 1. Two readers, two forms

The contract stays exact for the machine roles. The summary page is for the human.
The page uses the same facts as the contract; it does not hold new facts.

| Page section | Source | Owner |
| --- | --- | --- |
| Scope | Scout field `scope`, at most 600 characters | Scout |
| Requirements | The `Requirement:` headings in the contract | Code |
| Requirement statements | The first sentence under each `Requirement:` heading | Code |
| Allowed paths | The `allowedPaths` field | Code |
| Open questions, not covered, project rules, verification | Existing Scout fields | Scout |
| Answers | The operator answers in the guide | Human |

`parseReviewNotes` stays the exact inverse of `reviewNotes`. The tests check both directions.

### 2. Writing rules in the prompt

The repository is public, so the prompt cannot refer to a private rule file. The Scout prompt gets these rules:

1. Write sentences of 20 words or fewer.
2. Use the active voice.
3. Use one term for one thing.
4. Do not use more than three nouns in a row.
5. Use a list for steps.
6. Do not repeat a requirement in `proposal`, `design` or `tasks`. Give its name.

The rules apply to human prose. They do not change the exact stdout text, field names or codes in the contract.

### 3. A guided request without a model call

`REQUEST_TEMPLATE` already has the sections Goal, Limits and Tests of success. The guide asks one question for each section,
and it shows a short example. It then shows the request and asks the operator to confirm it. The request file stays the owner;
`prepare` binds it as today. An empty answer for Tests of success gives a warning, because the Scout then has no check to plan.

### 4. Questions before the draft

The Scout makes one `clarify` call before the draft. The call uses the same role, model, restrictions and context as the draft.
The output is JSON: `questions`, with 0 to 5 entries. Each entry has a question, 2 to 4 options and the recommended option.

- If there are no questions, the guide continues to the draft.
- The guide asks each question with `select`. The recommended option is first. The guide also offers "Other" and "Let the Scout decide".
- The guide writes the answers to `clarifications.md` in the run directory. The draft input is the request, then the answers.
- The run records the digest of the questions and the answers. The approval shows the request and the answers together.
- The operator can skip the clarification. Then no model call occurs.

Admission control counts the call like any other role call. The minimum model calls in the guide limits change from 4 to 5.

### 5. Answers at the review

At `spec-drafted`, the guide shows the summary page first. For each open question, the operator selects one:

- Accept the recommendation.
- Give another answer.
- Leave it to the files: the operator edits the specification files as today.

The guide writes the answers into the "Answers" section of `review-notes.md`. If an answer differs from the recommendation,
or a need is not covered, the guide offers "Redraft with my answers". The redraft is a Scout call with the request,
the clarifications, the previous draft and the answers. A run gets at most one redraft. After that, the operator edits the files or cancels the run.

### 6. What the approval covers

An approval binds the full specification revision, as today. The guide says this before the approval:
"You approve all files in the specification folder. The summary page gives the first sentence of each requirement; open the contract to read the scenarios."

The page gives each requirement name and its first sentence, so the operator reads what each requirement demands.
The risk: an operator who reads only the summary trusts the Scout to turn it into exact scenarios. The test writer and
the review Auditor still check the contract, but they cannot find a requirement that the operator did not want.
The operator accepted this risk on 26 November 2026, on the condition that the page gives the requirement statements.

## Plan checks

| Area | Plan |
| --- | --- |
| Capacity | One extra Scout call for clarification and at most one for a redraft. Admission control limits both. Each call records its tokens. |
| Concurrency | The guide writes answers only through a command that holds the existing execution lock. A second writer on the same run is refused, as today. |
| Data integrity | The draft input and the approval bind the request and the clarification digests. A changed answer file makes the draft stale. |
| Code quality | Prompt text and parsers stay in `src/domain/scout.ts`. Guide steps stay in `src/application/guide.ts`. Effects stay in commands. |
| Verification | Unit tests for the parsers and the page. Guide tests with a scripted UI. Interruption tests for each new write. One live pilot run. |
| Observability | Each pilot note records the question count, the answers that differ from the recommendation, the redraft count, the page size and the review time. |
| Recovery | An interrupted clarification keeps the questions file; `resume` asks again without a new call. An expired run can only be cancelled, as today. |

## Measures of success

Measure these on the first pilot run after installation, and compare them with `trial-05`:

- The summary page has 600 words or fewer, excluding the allowed paths and the requirement statements.
  Record the word count of the requirement statements separately. Its size is not measured yet.
- The review, from the draft to the approval or the cancellation, takes less than 15 minutes.
- The operator edits no specification file by hand.
- The draft has no `NOT COVERED` entry for a need that the request names.

One run is not enough evidence to accept the change. Record each result in `docs/PILOT-NOTES.md`.

## Open decisions for the operator

The operator answered these decisions on 26 November 2026. The answers do not approve implementation.

1. **Sequence.** Run the planned canary on the installed release first. It gives a baseline for these measures. *Accepted.*
2. **Clarification budget.** At most 5 questions and one call. More questions slow the operator more than an edit does. *Accepted.*
3. **Redraft limit.** One redraft for each run. A second redraft suggests that the request needs a new run. *Accepted.*
4. **Summary-only review.** *Accepted, with a condition:* the page gives the first sentence of each requirement (decision 6).
