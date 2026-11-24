# Task-based model selection and token budgets

Status: approved for source implementation. Model qualification remains pending.

On 15 November 2026, the operator approved the scope at commit `25ddb49` and a manual source-work exception.
The approval covers scope and manual source work.
The exception permits code, synthetic tests and independent review in PR #2.
Installation, live pilots and merge still require separate approval.

## Why

Aegean uses the same Claude model for specification work and both Auditor tasks.
The Builder uses the Codex default, and recorded token counts do not control execution.
Task-specific models and smaller inputs can reduce usage, but only if the same checks still pass.

## What Changes

- Select a model and reasoning effort through a fixed policy for each task class.
- Use smaller models only for task classes that pass a recorded comparison against the baseline.
- Limit supplied context by task, with complete requirements and explicit records of omitted optional files.
- Check token allowances before each call. Record usage once, including repairs, revisions and interrupted calls.
- Distinguish measured usage, estimated input and provider-enforced limits. Refuse a hard cap when the adapter cannot enforce it.
- Keep protected tests, independent review, human decisions and subscription-only authentication.
- **BREAKING:** new runs bind the model and budget policy. Existing runs retain their original policy and release.

## Capabilities

### New Capabilities

- `task-model-policy`: model choice, task context and qualification evidence.
- `token-budget-control`: call admission, usage records and recovery of token allowances.

### Modified Capabilities

None. The repository has no existing OpenSpec capability files.
The change extends the [accepted plan](../../../docs/PLAN.md) without replacing the bounded CLI requirements.

## Impact

The work affects workflow policy, role execution, usage records, Builder configuration, status output and related tests.
The design keeps domain rules separate from CLI and storage adapters.
It adds no scheduler, model-based router, paid API route or additional Builder capacity.

Use [PR #2](../../../docs/history/pull-requests/2.md).
Complete its pilot, decision and recovery controls before the combined lifecycle qualifies for release.
Keep product documentation focused on available behaviour; link this proposal from the engineering reference.

See [design](design.md), [requirements](specs/task-model-policy/spec.md),
[budget requirements](specs/token-budget-control/spec.md) and [tasks](tasks.md).
