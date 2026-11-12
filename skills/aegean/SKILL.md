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

Human specification approval is an exact-hash GitHub comment. Only the human
merges the final PR. Never author an approval comment on the human's behalf,
change a suite to fit implementation, or treat agent success text as test evidence.
The coordinator owns state, budgets and credentials; agents do not edit its state.

If any required capability is unavailable, continue discovery/specification work
and report the precise missing gate. Do not pretend visible tests establish
protected verification. Use `aegean cancel` for a deliberate stop; never delete a
lease or take ownership from another host automatically.

For simple operations, use the normal project workflow and relevant checks. Do
not create an OpenSpec change or invoke multiple agents for a typo or read-only
question. Escalate to the full workflow if the operation becomes consequential.
