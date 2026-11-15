# Design

## Context

This assessment uses PR #2 at `952ec75126d3c706d8df61a6e6bea6f90addab9c`.
See the [proposal](proposal.md) for scope and the reason for this change.

| Current owner | Observed behaviour |
| --- | --- |
| `src/adapters/agents.ts` | Scout and both Auditors use the `sonnet` alias. |
| `src/application/builder.ts` | Codex has no explicit model or effort argument. |
| `src/application/engine.ts` | Scout source has a 60,000-byte limit; review diffs have a 200,000-byte limit. |
| `src/adapters/usage.ts` | The last top-level usage event supplies counts; missing values remain null. |
| `src/application/role-result.ts` | Completed effects are reused; usage is written after the completed result. |
| `src/domain/workflow.ts` | A frozen policy controls time, repairs and revisions. |

The recorded pilot project trial has unreliable input usage. It cannot establish savings or a safe default token allowance.
The pending controls in [bounded CLI progress](../../../docs/BOUNDED-CLI-PROGRESS.md#remaining-work-in-order) remain release dependencies.

## Goals / Non-Goals

**Goals:** deterministic model choice, less optional context, explicit budget behaviour and complete recovery records.

**Non-goals:** new providers, paid API authentication, concurrent Builders, automatic policy migration or weaker acceptance checks.
This change does not install a release, authorise a pilot or merge the PR.

## Decisions

### 1. Use a frozen policy, not a model-based router

Add pure model-policy and token-accounting rules under `src/domain/`.
Keep CLI controls in adapters and call admission in the application layer.
Extend the existing policy digest and strict schemas instead of creating another configuration owner.

The policy names exact model identifiers, supported effort, context limits, token allowances and qualification report digests.
Record requested and reported model identities separately. Alias resolution alone is not a stable qualification identity.
Unavailable models pause execution; they do not select an unrecorded fallback.

| Task | Proposed selection | Context |
| --- | --- | --- |
| Scout: narrow, explicit request | Qualified smaller Claude model; otherwise baseline | Request, applicable instructions, file map and selected source |
| Builder: bounded local edit | Qualified smaller Codex model; otherwise baseline | Complete approved contract, task files, public checks and public repair feedback |
| Test Auditor | Baseline Claude model | Complete approved contract; no candidate implementation |
| Final review Auditor | Baseline Claude model | Complete contract and complete candidate diff |
| Security, storage, concurrency, migration or workflow controls | Baseline | Complete relevant contract and dependencies |
| Coordinator, status and test execution | No model | Structured state and deterministic checks |

The first candidate comparison uses a Haiku model against Sonnet for the Scout, and `gpt-6-luna` against `gpt-6.1-sol` for the Builder.
These are comparison candidates, not activated defaults. Resolve Claude identifiers and confirm subscription access before qualification.
Select supported effort explicitly. A missing capability prevents activation rather than silently changing the setting.

Task classification uses an approved structured scope and deterministic exclusion rules.
Before specification approval, the Scout uses the baseline unless the request has an explicit, validated task classification.
Unknown scope uses the baseline. A candidate cannot classify itself as routine.
One failed smaller-model Builder attempt can use a remaining repair with the baseline.
Malformed output, uncertainty or a failed check never creates a free retry.

### 2. Limit context without hiding required evidence

Create a context manifest with path, content hash, byte count, purpose and inclusion result.
Include mandatory instructions and the approved contract before optional source.
Select optional files from approved task paths and direct dependencies in a stable order.
Pause when necessary dependencies cannot fit; do not silently omit them.

Keep the complete review diff. Preserve the current pause for oversized reviews.
Keep each role process fresh and preserve the Builder's restricted bridge.
Bound cumulative bridge output as well as the initial prompt; record when the limit stops a tool response.
Reject oversized required tool output rather than presenting a partial result as complete.

Token estimates must name their tokenizer and scope. Byte counts remain byte counts.
Host instructions, CLI system text and tool schemas can add context outside Aegean's prompt.
Report that gap unless the pinned adapter exposes and bounds the complete input.
Reducing a model's advertised context window is not the context selection mechanism.

### 3. Separate monitored allowances from hard caps

Require explicit positive per-call and per-run token allowances in each activated policy.
Choose live values from qualification measurements, then freeze them before a run.
Synthetic fixtures use small known limits; they do not establish live defaults.

Monitored mode reserves a planned allowance and settles measured usage after each call.
It can stop subsequent calls, but an in-flight call can exceed the reservation.
Report an overrun and pause; do not report a negative remainder as available capacity.

Strict mode requires a proven upper bound over every request and generated response in the CLI session.
It reserves that bound before process creation and refuses unsupported adapters.
Streaming cancellation alone is insufficient because events can arrive after consumption.

The [OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) distinguishes context, compaction and reasoning settings.
It also lists goal budgets. None of these alone proves a hard cap for Aegean's complete `codex exec` invocation.
The [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) documents model selection, turn limits and an estimated dollar limit that can overrun.
A dollar limit does not enforce a subscription token allowance.
Local help confirms model and effort controls; no end-to-end hard token bound was demonstrated in this assessment.

Keep strict mode unavailable until pinned-CLI probes prove its controls.
Offer monitored mode only with its explicit limitation. Never add paid API fallback to obtain a missing control.

### 4. Reuse ownership and durable effects

Reserve tokens under the existing run ownership and execution permit.
Bind each reservation to the role effect, ownership generation, policy and selected model.
Perform no model or network work inside a local state transaction.
Preserve one global Builder and one execution permit per repository.

Use the role effect identifier as the usage record key, replacing timestamp-only identity for new records.
Persist completion and enough validated usage data to reconstruct settlement.
On recovery, replay settlement idempotently from the saved result before another call.
The current completion-before-usage gap must not lose a charge.

Keep uncertain reservations charged until reconciliation proves the outcome.
Do not refund a call merely because its process exited or its result is missing.
Apply existing pilot, active-time, repair and revision checks before token admission.
Count every attempted call, including escalation, repair and contract revision.

Provider-specific parsers define whether fields are cumulative or incremental.
Count cached input once within total input. Add separate cache-creation counts only when the provider excludes them from input totals.
Count reasoning within output when already included; do not add it twice.
Reject malformed, contradictory or incomplete usage instead of substituting zero.

### 5. Qualify a smaller model for a narrow task class

Use at least ten held-out synthetic tasks per class, with three paired attempts per task.
Freeze the fixture manifest before comparison. Keep qualification cases separate from policy-tuning cases.
Run baseline and candidate with the same requirements, checks and attempt limits.
Include all repairs and escalations in usage and completion measurements.

Activation requires all of these results:

- No candidate failure on a task that the baseline completes in the paired attempt.
- No missed mandatory requirement or accepted seeded defect.
- Known usage for every attempt; no selective removal of failures or retries.
- At least 20% lower median total tokens per completed task, with no increase in the observed 95th percentile.
- The same protected verification and baseline final review for Builder output.

These thresholds qualify the recorded task class only. They do not prove universal reliability.
Keep the baseline when the candidate fails. Do not weaken a check to qualify a model.
Model, effort, context or CLI changes invalidate the related qualification until re-evaluation.

## Risks / Trade-offs

- Small evaluation samples miss rare failures. Retain baseline review and report sample sizes and failures.
- Missing usage can stop otherwise useful work. Preserve diagnostics and require reconciliation before more calls.
- Monitoring permits an in-flight overrun. Display its enforcement level; reject strict mode without proven bounds.
- Context selection can omit dependencies. Record omissions and pause when required context exceeds the limit.
- Extra comparisons consume tokens. Use a separately approved, bounded qualification run; do not evaluate during ordinary task execution.

## Migration Plan

1. Complete specification review and establish an authorised implementation route.
2. Add synthetic coverage for policy, context, usage and recovery before production integration.
3. Complete the existing bounded CLI dependencies and test the combined lifecycle.
4. Run independent review and the full suite. Publish changes only to the current PR.
5. Qualify models and adapters on an explicitly authorised candidate. Retain baseline selection until qualification passes.
6. Use the maintained installer only after separate installation approval.

Existing runs retain their original release and policy. A changed policy requires a new run and fresh decisions.
Rollback restores the prior release for compatible runs; it does not rewrite usage or reuse newer acceptance evidence.

## Current execution gate

On 15 November, installed `aegean doctor --json` confirms both subscriptions but reports no verifier VM and no release acceptance.
This checkout also has no `aegean.json` enrolment file.
The installed Aegean skill permits discovery and specification work while required capabilities are unavailable.
The earlier bootstrap exception does not authorise this new feature automatically.
The operator subsequently approved the manual source-work exception recorded in the proposal.
The live execution gates remain unchanged.
