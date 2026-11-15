# Task model policy

## Purpose

Select suitable models and context for each task without reducing the evidence required to accept a software change.

## ADDED Requirements

### Requirement: Fixed task policy

The coordinator MUST select each role's model and supported effort from a versioned policy before execution.
The run MUST bind that policy, its task class and its qualification evidence.
Unknown task classes MUST use the baseline.
Candidate files and model responses MUST NOT change this policy.

#### Scenario: Routine task with current qualification
- **WHEN** an approved task class has valid qualification for a smaller model
- **THEN** the coordinator selects that model and records the policy rule
- **AND** the selection includes explicit model and effort settings supported by the adapter

#### Scenario: Unqualified or consequential task
- **WHEN** a task lacks qualification or affects security, permissions, persistence, concurrency, migration or workflow controls
- **THEN** the coordinator selects the baseline
- **AND** no model call classifies the task

#### Scenario: Model or policy drift
- **WHEN** the required model is unavailable, its reported identity differs, or the frozen policy changes
- **THEN** execution pauses before any further role call
- **AND** no default model, provider fallback or paid API replaces the selected model

### Requirement: Evidence before smaller model use

A smaller model MUST pass the declared comparison for its task class before activation.
The report MUST identify models, effort, context policy, fixtures, attempts, usage and verification results.
Missing usage or an acceptance regression MUST prevent qualification.
Qualification MUST NOT transfer automatically to a different model or policy.

#### Scenario: Comparison fails
- **WHEN** the smaller model misses a required result, accepts a known defect, or has unknown usage
- **THEN** its task class remains on the baseline
- **AND** the report retains all failed and repeated attempts

### Requirement: Complete required context

Each role MUST receive complete required context within its declared input limit.
Optional source selection MUST be deterministic and record omitted paths.
Required context that exceeds a limit MUST pause the call.
Protected tests and credentials MUST remain outside Builder context.

#### Scenario: Small specification task
- **WHEN** the task fits its context allowance
- **THEN** the Scout receives the request, applicable instructions and selected source
- **AND** the record identifies source hashes, byte counts and any token estimates

#### Scenario: Required context exceeds the limit
- **WHEN** the approved contract or complete review diff exceeds its role's allowance
- **THEN** no role call starts
- **AND** the status names the exceeded limit without silently truncating the contract or diff

### Requirement: Verification retains its authority

Model selection MUST preserve protected tests, independent final review and exact human approval boundaries.
The test Auditor and final review Auditor MUST retain the qualified baseline in this change.
One smaller-model Builder attempt MAY escalate to the baseline within existing repair and token allowances.
Escalation MUST NOT reset any allowance or change the approved contract.

#### Scenario: Smaller model fails verification
- **WHEN** protected tests reject its candidate and a repair remains available
- **THEN** the baseline Builder receives the existing public repair feedback
- **AND** the same protected suite checks the repaired candidate
- **AND** the failed attempt remains charged to the run

#### Scenario: No repair allowance remains
- **WHEN** a smaller-model attempt fails and any required allowance is exhausted
- **THEN** the run stops for a human decision without an extra model call
