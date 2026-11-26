# Guided specification

## Purpose

Let the operator review and correct a specification draft from one page and guided questions, without less detail in the contract.

## ADDED Requirements

### Requirement: Summary page

The review notes MUST give the scope, each requirement name and its first sentence, each allowed path, the open questions, the needs that the draft does not cover and the verification.
Code MUST take the requirement names and first sentences from the contract and the allowed paths from the draft.
Parsing the review notes MUST give the same summary that the draft gave.

#### Scenario: Page agrees with the contract
- **WHEN** the Scout returns a valid draft
- **THEN** the review notes list each `Requirement:` heading of the contract, in the same order
- **AND** each heading has the first sentence of its requirement text
- **AND** the review notes list each allowed path of the draft

#### Scenario: Requirement without a statement
- **WHEN** a `Requirement:` heading has no text before its first scenario
- **THEN** the draft is refused with the fault `fields: requirements`

#### Scenario: Scope too long
- **WHEN** the Scout returns a scope of more than 600 characters
- **THEN** the draft is refused with the fault `fields: scope`

### Requirement: Questions before the draft

Before the draft, the Scout MUST be able to return 0 to 5 questions. Each question MUST have 2 to 4 options and one recommended option.
The guide MUST ask each question and record the answers before the draft call.
The draft input and the approval MUST bind the answers.
The operator MUST be able to skip the questions; a skip MUST make no model call.

#### Scenario: Clear request
- **WHEN** the clarify call returns no questions
- **THEN** the guide continues to the draft without a question

#### Scenario: Interrupted answers
- **WHEN** the guide stops after the clarify call and before the last answer
- **THEN** a later `aegean guide` asks the remaining questions without a new model call

#### Scenario: Changed answers after the draft
- **WHEN** the answer file changes after the draft
- **THEN** the approval is refused, because the draft is stale

#### Scenario: No admission
- **WHEN** the pilot limits have no model call left
- **THEN** no clarify process starts and the guide offers to skip the questions or cancel the run

### Requirement: Answers at the review

At the review, the guide MUST show each open question with the Scout recommendation first.
The guide MUST write each answer to the review notes.
A run MUST get at most one redraft. A redraft MUST clear later evidence and MUST need a new approval.

#### Scenario: All recommendations accepted
- **WHEN** the operator accepts each recommendation
- **THEN** the guide records the answers and offers the approval without a redraft

#### Scenario: Different answer
- **WHEN** the operator gives an answer that differs from the recommendation
- **THEN** the guide offers one redraft with the answers

#### Scenario: Second redraft
- **WHEN** the run already had one redraft
- **THEN** the guide offers no redraft and tells the operator to edit the files or cancel the run

### Requirement: Approval scope

Before the approval, the guide MUST tell the operator that the approval binds all files in the specification folder.

#### Scenario: Approval from the summary
- **WHEN** the operator selects the approval
- **THEN** the guide states that the approval covers the full contract and gives the path of the contract file
