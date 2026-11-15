# Model policy source review

Independent review completed on 15 November 2026 against the source changes after `25ddb49`.
The review included the prerequisite implementation from `eaa8d5e` and the new model, context and accounting controls.
The reviewer inspected code without changing files or executing live calls.

## Findings and resolution

| Finding | Resolution and regression coverage |
| --- | --- |
| Expired pilots could reach archive and final evidence. | Archive uses a deadline, expiry checks and accounted attempts. Expired final receipts remain unknown. |
| Missing local accounting hid durable status. | Status preserves durable state and reports unavailable accounting. Execution still rejects missing or incompatible records. |
| An earlier Codex turn could settle incomplete usage. | Incomplete, failed and interrupted calls retain reservations. Tests cover trailing unfinished turns and earlier usage events. |
| Changed task files could prevent completed Builder replay. | Completed effects retain their original context identity. A checkpoint-interruption fixture proves one Builder call. |
| Required-context errors lacked a durable pause. | Scout and Builder overflow tests require paused state, a named limit and no affected role launch. |
| Repeated tool errors could continue after output exhaustion. | Exhaustion aborts Builder. The bridge fixture checks bounded attempts, no candidate import and released capacity after cleanup. |
| Qualification could survive a related policy change. | Qualification binds task class, workflow and context versions, limits, model settings, and both Auditor policies and CLI version. |

Follow-up review found no remaining actionable finding in these changes.
Automated test results have a separate owner in [bounded CLI progress](BOUNDED-CLI-PROGRESS.md).

## Limits

The review does not establish live provider usage semantics, smaller-model quality, token savings or native release acceptance.
The shipped policy retains baseline selection. Live qualification remains a separate approved exercise.
