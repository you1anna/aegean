# Aegean development

This repository contains the Aegean software-delivery coordinator.
Keep unrelated projects and their records outside this checkout.

Read README.md, docs/PLAN.md and docs/STATUS.md. Code changes use a branch and a
human-reviewed PR. A documentation-only change, for example a close note or a status
record, can go directly to `main` if the user asks for it in the current chat. Add
`[skip ci]` to the message of that commit. A ruleset on `main` requires a PR and the
`deterministic` check; the administrator bypass exists only for these documentation
pushes. Never merge, publish, deploy, change billing, or bypass the verifier without
the user's explicit instruction. The initial documentation commit on main is the
recorded bootstrap exception.

Keep workflow rules pure; CLI/process/network/filesystem code belongs in
adapters. One owner per fact. Do not add an orchestration framework, background
model polling, or general scheduler. Use subscription CLI authentication only.
Agent success text is not verification evidence. Unsupported controls fail closed.

Run `npm ci`, `npm run check` and `npm test`. Test rejection, concurrent ownership,
stale evidence, interruption and idempotence. Keep fixtures synthetic. Do not
commit credentials, private suites, run databases, raw prompts or old project
records. Docs must distinguish tested behaviour from outstanding release gates.

For every PR, apply the documentation standard in
[CONTRIBUTING.md](CONTRIBUTING.md#documentation).

For every real run, capture console output and add an entry to
docs/PILOT-NOTES.md, as "Run records and debugging" in docs/OPERATIONS.md
describes. Raw logs stay outside Git.

Release changes are installed by the maintained installer, never hand-copied.
Use versioned releases and preserve unrelated user configuration. Existing
projects retain their own dependency managers and deployment boundaries.
