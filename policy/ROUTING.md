This routing applies only to the exact host, accepted release, bounded-cli-v1
capability and local repositories listed above. Installation alone does not
activate routing or establish acceptance. Before significant work in this scope,
run `aegean doctor --json`, check the recorded project policy against the current
committed `aegean.json`, and use the installed `aegean` skill. Changed acceptance,
release, capability or project policy requires explicit review and reactivation.

For accepted work within this scope, use an isolated branch, a human-approved
specification, protected verification and a human-reviewed PR. Simple low-risk
operations retain proportionate checks and their existing Git workflow.

Other projects and unsupported adapters retain their separately approved project
workflow; they are not Aegean-verified. Preserve project data restrictions and
production/deployment approvals. Never enrol sensitive, parked, third-party or
production checkouts automatically. Use subscription CLIs only, never paid API
fallback. Missing capabilities do not authorize fabricated evidence or bypasses.

The installer maintains this block only through explicit routing actions:
`--activate-routing --project OWNER/REPO --project-path PATH` (repeat the paired
options for additional repositories), `--deactivate-routing`, `--migrate-routing`
and `--recover-routing`. Migration backs up and removes legacy mandatory blocks;
activation remains separate. Upgrade or rollback while routing is active is
refused until explicit deactivation. Reaccept and reactivate the selected release
afterward. Interrupted edits retain a transaction and backups; recovery completes
an already finished transaction or restores the exact previous files, and refuses
unexpected edits. It never restores unrelated instructions from stale backups.
