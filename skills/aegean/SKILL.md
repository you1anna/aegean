---
name: aegean
description: Route significant software or system changes through Aegean's approved specification, isolated implementation, protected verification and human review. Use for substantial features, consequential fixes, migrations, infrastructure and security changes; ordinary small low-risk operations remain lightweight.
---

Run `aegean doctor --json` first. Read the reported gaps and installed operations
guide. An installed skill is not proof that the full workflow is accepted.

For eligible significant work, inspect repository instructions and run
`aegean enrol --check` before creating a run. Enrolment is explicit and preserves
project-specific dependency managers and production access rules. Use
`aegean start --request <file>` to begin a run and `aegean status` / `aegean resume`
for its checkpoints. Never start a second independent Builder for the same run.
Before you give the human a command, run `aegean status --json` or `aegean status --run ID --json`
and give the `next` step that it prints. Add `--json` to each command that you read: without it,
a terminal gets text for a person. A run exists only after `aegean prepare`.
The Scout reads only the committed files that `aegean project check` lists.
For the route from the host check to the specification approval, tell the human to run
`aegean guide` in their own terminal. Never operate the guide; it refuses a pipe.

For local approval policy, the human uses `aegean approve --run ID`, then resumes.
`aegean publish --run ID` separately authorizes and pushes the exact reviewed
candidate. `aegean revise --run ID --scope implementation|contract` invalidates
old evidence; contract changes require new approval and tests. Agents must never
answer these terminal prompts. Explicit `github-comments` policy retains exact
hash-bound comments; do not silently switch modes. Only the human merges the
final PR. Never author an approval comment on the human's behalf,
change a suite to fit implementation, or treat agent success text as test evidence.
The coordinator owns state, budgets and credentials; agents do not edit its state.
A pilot needs separate scoped, expiring `authorize-pilot` authorization and passing
native prerequisites. The project must declare modelExecution with token allowances and task scope.
Monitored allowances can overrun within a call. Strict token caps are unsupported and reject execution.
Unknown usage blocks another model call; recovery never resets charges.
Smaller models require task-specific qualification; both Auditors retain the baseline. Installation, live
pilot execution, readiness acceptance and publication retain separate gates.

If any required capability is unavailable, continue discovery/specification work
and report the precise missing gate. Do not pretend visible tests establish
protected verification. Use `aegean cancel` for a deliberate stop; never delete a
lease or take ownership from another host automatically.

For simple operations, use the normal project workflow and relevant checks. Do
not create an OpenSpec change or invoke multiple agents for a typo or read-only
question. Escalate to the full workflow if the operation becomes consequential.
