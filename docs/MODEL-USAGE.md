# Model use and token allowances

[Operations](OPERATIONS.md) · [Architecture](ARCHITECTURE.md) · [Acceptance](ACCEPTANCE.md)

Aegean selects a model and effort before each role call. It records usage and checks the remaining allowance before another call.
The source includes these controls. Live model qualification remains pending.

## Model selection

[toolchain.json](../toolchain.json) owns model settings and context limits.
The Scout and Builder can use a smaller model for an approved, qualified task class.
Unknown or consequential scope uses the baseline. Repairs use the baseline.
Both Auditor tasks retain the baseline, and the verifier uses no model.

The [live qualification plan](../openspec/changes/task-model-selection-and-token-budgets/qualification.md) proposes the Builder comparison and trial allowances.
It requires approval before execution.

The shipped policy has no smaller-model qualification entries. It therefore selects the baseline for every model role.
Unavailable models and reported model changes stop execution; no provider or API fallback replaces them.
A requested model identifier is not proof of the model actually served. Usage records preserve that distinction.

Qualification binds the task class, model settings, CLI version, context controls and workflow policy.
A change to context selection or verification rules requires a policy-version change and fresh qualification.
[The model policy validator](../src/domain/model-policy.ts) owns the quality and usage thresholds.

## Adapter controls

| Adapter | Explicit settings | Usage source | Strict token cap |
| --- | --- | --- | --- |
| Claude Code | Model and effort | Final result, including separate cache counts | Unsupported |
| Codex CLI | Model and reasoning effort | Complete turn events; incomplete calls remain unresolved | Unsupported |

The pinned versions are in `toolchain.json`. Their live usage semantics and actual model identities still need qualification.

## Project configuration

The reviewed `aegean.json` needs a `modelExecution` object before a new run starts.
This example uses synthetic test values. Choose and review allowances for the actual trial before use.

```json
{
  "modelExecution": {
    "budget": {
      "enforcement": "monitored",
      "maxTokensPerRun": 10000,
      "maxTokensPerCall": 1000
    },
    "task": {
      "class": "unknown",
      "paths": [],
      "dependencies": [],
      "concerns": []
    }
  }
}
```

Use `routine-cli` only for a narrow, reviewed edit to named existing files.
List task files in `paths` and required dependencies in `dependencies`.
Declare security, permissions, persistence, concurrency, migration or workflow concerns explicitly.
The coordinator also excludes known sensitive paths from smaller-model selection.
The human-approved scope remains authoritative; filename checks cannot establish the meaning of arbitrary code.

The frozen project digest binds this configuration. A change requires a new run.
Time, call, repair, revision and pilot limits still apply before execution.

## Enforcement limits

| Control | Behaviour |
| --- | --- |
| Monitored allowance | Reserves capacity before a call and settles validated usage afterwards. An in-flight call can overrun. |
| Strict token cap | Unsupported by the pinned subscription adapters. Execution is refused. |
| Required context | A complete contract, required file or review diff must fit; overflow pauses the run. |
| Optional source | A deterministic selection records omitted paths and the supplied byte count. |
| Builder command output | Repeated command results share a byte allowance. Exhaustion aborts the Builder before candidate import. |

Bytes are not tokens. Aegean does not label byte limits as token estimates.
CLI system instructions, tool schemas and internal responses can add context outside the supplied prompt.
Context-window and compaction settings do not establish a total token cap.

## Usage and recovery

Use `aegean status --run ID` to inspect consumed tokens, reservations, remaining allowance and unknown usage.
Status returns durable run state even when local accounting is absent or incompatible.

Usage records identify the effect, requested and reported model, effort, CLI version, policy, context hash and measurement source.
Claude cache creation and cache reads contribute to total input. Codex cached input is already part of its input total.
Reasoning counts do not add to output when the provider already includes them.
Malformed or incomplete events remain unknown.

Completed effects settle once. Recovery uses their saved results without another model call.
An interrupted call keeps its reservation, even if an earlier turn reported usage.
A revision, repair, release change or explicit resume cannot reset the charge.

If usage remains unknown, inspect the private effect and accounting records.
Use the documented recovery command only after process inspection. Do not edit the records or invent a refund.
When reconciliation cannot prove usage, cancel the run rather than force another call.

Old runs retain their original policy and compatible release. Source updates do not update installed releases or acceptance evidence.
