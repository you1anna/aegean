# Pull-request archive

Aegean was developed in a private repository. That repository is kept as a private archive.
This folder keeps the record of each of its pull requests: title, description, comments,
CI result and commits. Commit hashes refer to this repository.

The `Merge pull request #N` commit messages refer to the numbers in this archive,
not to pull requests in this repository. Each merged PR has a tag `archive/pr-N` on its last commit.

Sensitive data was removed from the descriptions: session links, personal identifiers and
the names of unrelated private projects.

| PR | Title | Result | Branch | Merged |
| --- | --- | --- | --- | --- |
| [1](1.md) | Bootstrap gated Aegean workflow and managed Mac installation | merged | `bootstrap-v1` | 2026-11-12 |
| [2](2.md) | Add task model selection, token budgets and bounded CLI controls | merged | `bounded-cli` | 2026-11-15 |
| [3](3.md) | Add repeatable operator commands and self-contained Docker bootstrap | merged | `codex/local-operator-commands` | 2026-11-15 |
| [4](4.md) | Check the stopped-owner PID in the routing recovery test | merged | `test/routing-recovery-pid-guard` | 2026-11-15 |
| [5](5.md) | Accept compatible Claude versions instead of an exact pin | merged | `codex/claude-version-compatibility` | 2026-11-16 |
| [6](6.md) | Give the Scout the ignore rules and project checks; guide the operator | merged | `fix/scout-context-operator-clarity` | 2026-11-16 |
| [7](7.md) | Harden the Scout draft and operator guidance code | merged | `refactor/scout-guidance-hardening` | 2026-11-16 |
| [8](8.md) | Add an interactive guide from the host check to specification approval | merged | `feat/interactive-guide` | 2026-11-16 |
| [9](9.md) | Record the next step after the interactive guide | closed without merge | `docs/close-note-interactive-guide` |  |
| [10](10.md) | Let cancel end a run that an older policy created | merged | `fix/cancel-older-policy-run` | 2026-11-16 |
| [11](11.md) | Keep a specification file open in the guide and flag a draft that is not complete | merged | `fix/guide-specification-review` | 2026-11-17 |
| [12](12.md) | Use claude-sonnet-5-5 at high effort for the Scout | merged | `feat/scout-sonnet-5-5-high` | 2026-11-17 |
| [13](13.md) | Check tests on the base commit, enforce allowed paths and route review findings | merged | `feat/build-stage-checks` | 2026-11-17 |
| [14](14.md) | Show the Aegean mark in the guide and tidy the menus | merged | `feat/guide-presentation` | 2026-11-17 |
| [15](15.md) | Show readable command results at a terminal | merged | `feat/readable-output` | 2026-11-17 |
| [16](16.md) | Explain stale source locks and give the recovery command | merged | `fix/stale-lock-guidance` | 2026-11-18 |
| [17](17.md) | Explain the architecture, isolation and design trade-offs | merged | `codex/presentation-docs` | 2026-11-18 |
| [18](18.md) | Withdrawn | closed without merge | `codex/friday-walkthrough` |  |
| [19](19.md) | docs: improve the workflow diagram layout | merged | `docs/workflow-diagram-style` | 2026-11-18 |
| [20](20.md) | fix: recommend aegean qualify when pilot prerequisites fail | merged | `fix/qualify-recovery-hint` | 2026-11-18 |
| [21](21.md) | fix: keep long values and observations readable in terminal output | merged | `fix/readable-qualify-output` | 2026-11-18 |
| [22](22.md) | refactor: split the workflow domain module by concern | merged | `refactor/domain-workflow` | 2026-11-19 |
| [23](23.md) | refactor: split the resume engine into a session and stages | merged | `refactor/engine-stages` | 2026-11-19 |
| [24](24.md) | feat: give aegean qualify next steps for each outcome | merged | `feat/qualify-next-steps` | 2026-11-24 |
| [25](25.md) | docs: prepare the repository for public release | merged | `docs/public-release-prep` | 2026-11-24 |
