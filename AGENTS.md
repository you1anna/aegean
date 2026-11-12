# Aegean development

This repository contains the Aegean software-delivery coordinator.
Keep unrelated projects and their records outside this checkout.

Read README.md, docs/PLAN.md and docs/STATUS.md. Significant changes use a branch
and a human-reviewed PR. Never merge, publish, deploy, change billing, or bypass
the verifier without the user's explicit instruction. The initial documentation
commit on main is the recorded bootstrap exception.

Keep workflow rules pure; CLI/process/network/filesystem code belongs in
adapters. One owner per fact. Do not add an orchestration framework, background
model polling, or general scheduler. Use subscription CLI authentication only.
Agent success text is not verification evidence. Unsupported controls fail closed.

Run `npm ci`, `npm run check` and `npm test`. Test rejection, concurrent ownership,
stale evidence, interruption and idempotence. Keep fixtures synthetic. Do not
commit credentials, private suites, run databases, raw prompts or old project
records. Docs must distinguish tested behaviour from outstanding release gates.

Release changes are installed by the maintained installer, never hand-copied.
Use versioned releases and preserve unrelated user configuration. Existing
projects retain their own dependency managers and deployment boundaries.
