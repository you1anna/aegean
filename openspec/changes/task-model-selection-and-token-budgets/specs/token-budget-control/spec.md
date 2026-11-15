# Token budget control

## Purpose

Control role admission and account for token usage across a run, including retries, repairs, revisions and recovery.

## ADDED Requirements

### Requirement: Explicit enforcement level

Every budget policy MUST declare either monitored or strict enforcement, with positive safe-integer limits per call and per run.
Monitored enforcement MUST disclose that an in-flight call can exceed its allowance.
Strict enforcement MUST refuse execution unless the pinned adapter has proven bounds for all input and generated tokens.
Context size, output bytes and monetary estimates MUST NOT substitute for token limits.

#### Scenario: Unsupported hard cap
- **WHEN** strict enforcement is selected but the adapter cannot bound every request and response in the call
- **THEN** no model process starts
- **AND** status identifies the unsupported control

#### Scenario: Monitored allowance exceeded
- **WHEN** measured usage reaches or exceeds the allowance
- **THEN** no further model call starts
- **AND** status reports any overrun without claiming a provider-enforced hard cap

### Requirement: Admission before execution

Before each call, the coordinator MUST check pilot scope and expiry, active time, repair limits, revision limits and token allowance.
It MUST reserve the call allowance durably before execution.
Concurrent callers MUST NOT spend the same remaining allowance.
Revisions and escalation MUST retain the run's consumed and reserved tokens.

#### Scenario: Allowance exhausted
- **WHEN** a proposed call exceeds the available run allowance
- **THEN** the coordinator rejects the call before process creation
- **AND** the record names the allowance that prevented execution

#### Scenario: Pilot expires before a repair
- **WHEN** the pilot expires before the next Builder attempt
- **THEN** the attempt cannot start even if tokens remain

#### Scenario: Concurrent admission
- **WHEN** two owners attempt to reserve the same remaining allowance
- **THEN** at most one owner succeeds
- **AND** stale ownership cannot create a call or settle a reservation

### Requirement: Validated usage

Usage MUST identify the role effect, requested model, reported model, CLI version, policy and measurement source.
Provider-specific parsers MUST distinguish total, incremental and cached counts without double counting.
Unknown, malformed, negative or unsafe counts MUST remain unknown and prevent further automatic calls.
Generated reasoning tokens MUST count once where the provider reports them.

#### Scenario: Duplicate or cumulative events
- **WHEN** a provider repeats events or reports both incremental and cumulative usage
- **THEN** accounting uses that provider's validated semantics
- **AND** each consumed token contributes once to the run total

#### Scenario: Missing final usage
- **WHEN** a process exits without a valid usage result
- **THEN** the reservation remains unresolved
- **AND** the run pauses without treating missing usage as zero

### Requirement: Recovery preserves charges

Each effect MUST have one durable reservation and one idempotent settlement.
Recovery MUST reuse completed results and reconstruct missing usage records without another model call.
An uncertain call MUST retain its reservation until reconciliation proves its outcome.
Unproven refunds and automatic retries of uncertain effects MUST be rejected.

#### Scenario: Crash after completion
- **WHEN** the result exists but the process stopped before usage settlement
- **THEN** recovery settles from that result exactly once
- **AND** it does not invoke the model again

#### Scenario: Lost effect outcome
- **WHEN** recovery cannot prove whether a reserved call ran or consumed tokens
- **THEN** the run retains the reservation and requires an explicit recovery decision
- **AND** cleanup and ownership safeguards remain active

### Requirement: Policy compatibility and reporting

Status MUST show the enforcement level, consumed tokens, outstanding reservations, remaining allowance and unknown usage.
Policy changes MUST NOT reset charges or silently migrate an existing run.
Reports MUST exclude raw prompts, credentials and protected test content.

#### Scenario: Resume with a different release policy
- **WHEN** the installed policy differs from the run's frozen policy
- **THEN** resume refuses new role execution
- **AND** the operator can inspect the run and use its original compatible release or cancel it
