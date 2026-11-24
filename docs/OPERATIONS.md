# Installation, use and recovery

[Documentation](README.md) · [Status](STATUS.md) · [Architecture](ARCHITECTURE.md)

This guide covers installation, commands and recovery for this source version.
For live work, use the operations guide reported by the installed `aegean doctor --json`.
See [source and installed versions](ENGINEERING.md#source-and-installed-versions).

> **Before a run:** read [current status](STATUS.md). Installation, live trials and release acceptance require explicit approval.

| Task | Section |
| --- | --- |
| Install and check a release | [Installation](#install-on-either-mac) · [Host commands](#host-commands) |
| Configure a host or project | [Configuration files](#configuration-files) · [Configuration procedure](#configure-and-approve-billing-policy) |
| Prepare a request and review its specification | [Interactive guide](#use-the-interactive-guide) · [Project and request](#prepare-the-project-and-the-request) |
| Verify and publish | [Verification and publication](#verification-and-publication) |
| Inspect or recover a run | [Run records](#run-records-and-debugging) · [Recovery](#recovery) |
| Migrate or remove an installation | [Control migration](#control-migration) · [Uninstall and reinstall](#uninstall-and-reinstall) |

## Install on either Mac

### Before installation

1. Use the host's own GitHub, Claude and ChatGPT logins. Do not copy authentication
   files between machines.
2. Clone the `you1anna/aegean` repository and review the intended commit.
3. Read [AGENTS.md](../AGENTS.md) and [STATUS.md](STATUS.md).
4. Inspect the host configuration. Preserve unrelated instructions and excluded paths.
5. Confirm explicit approval to install that version.

The bootstrap implementation is on `main`. A merged change does not update the
installed release or establish readiness. Each Mac needs its own evidence.

[toolchain.json](../toolchain.json) owns the required versions. Claude Code must
already be installed with subscription authentication.
The Claude requirement is a stable-version range: at least the declared minimum, below the next major version.

Newer versions within that range do not require a source change or a Claude downgrade.
Old, prerelease and unrecognised versions fail the check.

Colima must match the declared version. Bootstrap downloads the pinned Docker client
from [Docker](https://download.docker.com/mac/static/stable/), verifies archive and binary SHA-256 hashes, and includes it in the release.
The installed command selects that client automatically. Homebrew Docker and shell configuration remain unchanged.

### Install the reviewed version

From a clean, committed checkout, run:

```sh
sh scripts/bootstrap.sh
~/.local/bin/aegean info --json
~/.local/bin/aegean doctor --require prerequisites
```

The bootstrap installs pinned Node through mise, installs locked packages with
lifecycle scripts disabled, checks types and script syntax, and installs a versioned release.
It does not repeat the development test suite. Run source tests during development and review; see [testing](TESTING.md).

It can install mise through Homebrew if mise is absent. It also configures the
dedicated Colima verifier through `scripts/setup-verifier.mjs`.

No backup or Docker PATH export is required. Downloads use a private staging directory and an exclusive lock.
A checksum or network failure stops installation and permits a clean retry.

If interruption leaves a `host-tools/docker-<version>-<arch>.lock` directory, confirm no installer remains before removing that lock.
If interruption leaves `.aegean/source-launcher` or `.aegean/source-task`, `scripts/dev` and the bootstrap refuse to start.
The message tells whether the recorded owner process still runs, and it gives the removal command.
The lock is never removed automatically. Remove it only when no Aegean source command runs.
If a cached client fails its integrity check, inspect and remove that client, then repeat bootstrap.

Codex and OpenSpec live inside the release. The installer copies the existing
Claude binary into the release. It leaves the ordinary Claude installation and
the desktop app unchanged.

`aegean info --json` reports the copied Claude version under `toolVersions`.
The artifact manifest covers `tool-versions.json` and the copied binary, so run evidence identifies the exact installed tool.
Ordinary Claude updates do not change that copy. Repeated installation of the same source reuses its existing release.

A compatible version passes the version check; native qualification and release acceptance remain separate requirements.

The installer exports the recorded commit and builds in an empty directory.
It rejects uncommitted source, including nonignored untracked files. Old local
`dist/` files cannot enter the release. The manifest records source, compiled
output, shipped files, links, executable modes and the external Node executable.
See [acceptance identities](ACCEPTANCE.md#identities).

Never copy changes directly into an installed release. Use the maintained
installer so the recorded identity matches its contents.

### Check the installation

Read `fullWorkflowReady` and each check from `doctor`; command completion alone
is not acceptance. Use the reported `operations` path for that release's guide.

The command lives in `~/.local/bin`. If that directory is absent from `PATH`, use
its absolute path. Skills live in `~/.agents/skills/aegean` and
`~/.claude/skills/aegean`. The installer adds managed guidance with backups.
Restart existing agent sessions if they do not discover the skill.

After approval for native qualification, run:

```sh
aegean qualify
aegean doctor --require prerequisites
```

Qualification records Builder containment and protected-verifier observations for the exact installed host and release.
It does not call models or accept the full release. Failed or unknown observations block pilot execution.
The result ends with the next steps. For a failed, unknown or uncleaned control, the steps name the control and the command to run next.
The historical host-Builder probe is retired; do not use it as an installation check.

The verifier uses a dedicated Colima profile and a pinned image. Keep the user's
other Docker context selected; Aegean names its context explicitly. Never expose
the host home or Docker socket to candidate code.

VM resources come from [toolchain.json](../toolchain.json). Candidate limits come
from [the verifier adapter](../src/adapters/verifier.ts): 1 CPU, 512 MiB of memory,
64 processes and 15 seconds per case.

## Host commands

Inspect the installed release and authentication without model calls:

```sh
aegean info --json
aegean auth status
aegean verifier status
aegean doctor --require prerequisites
```

If a subscription login is absent, authenticate in your own terminal:

```sh
aegean auth login claude
aegean auth login codex
```

Start the existing dedicated verifier when needed:

```sh
aegean verifier start
aegean doctor --require prerequisites
```

Start preserves the selected Docker context. It does not pull images or replace missing provisioning.
If provisioning is absent, use the reviewed bootstrap installer. An uncertain transition retains its host reservation.
After you confirm the owning process stopped, inspect the VM and use `aegean verifier recover --confirm-stopped`.
This command clears stopped host reservations only; it does not clear run ownership or resources.

Stop the verifier after work completes:

```sh
aegean verifier stop
```

Stop refuses active or uncertain resources and retained containers. Inspect the run records before recovery.
`doctor --require prerequisites` exits nonzero when a prerequisite fails.
`doctor --require full` also requires release acceptance. Default `doctor --json` reports state without a readiness exit check.
Use `aegean COMMAND --help` to inspect command arguments. Unknown and duplicate options fail before effects.

### Read command output

Each command except `aegean guide` selects its output format from the destination:

- At a terminal, the command writes text. Fields are labels in words: `fullWorkflowReady` shows as
  "Full workflow ready". Dates show in UTC and durations in minutes and seconds.
  Host checks show ✔ (pass), ✖ (fail) or ! (information only).
  Qualification observations show ✔, ✖ or ? (unknown) and the outcome word on the line with their name.
  A value that does not fit beside its label, such as a digest or a path, starts on the next line.
  Text breaks at spaces, and a list without spaces breaks after a comma. A word is never cut.
  An `error` or `blocked` field comes first. The `next` steps come last, with each command on its own line.
- To a pipe or a file, the command writes JSON.
- With `--json`, the command writes JSON at a terminal too.

A failure follows the same rule on standard error. At a terminal, it shows the message and the recovery advice.
Otherwise it writes one line of JSON with the `error` and `recovery` fields. The format never changes the exit code.

Use `--json` in scripts and agent instructions, and when you report a problem. A program that runs a
command under a terminal emulator otherwise gets text. The text form removes terminal control characters
from results. It shows up to 200 items of a list; the JSON form has all of them.

## Configuration files

| File | Purpose |
| --- | --- |
| Repository `toolchain.json` | Runtime pins, Claude compatibility range, VM and image pins |
| Repository `mise.toml` | Source runtime selection, checked against the Node pin |
| Root and tools `package-lock.json` | Locked dependencies; source setup preserves these files |
| Project `aegean.json` | Reviewed approver, task scope, verifier and token allowances |
| Private `~/.local/state/aegean/settings.json` | Host identity, exclusions, billing acknowledgement and control locations |
| Operator-selected `pilot-limits.json` | Reusable pilot duration and call limits; not approval |
| Installed `installation.json` | Recorded release identity; never edit this file |

Start from the [project example](../examples/aegean.json) and [pilot limits example](../examples/pilot-limits.json).
Replace the example repository, approver ID, commands and task scope with reviewed values for your project.
The sample token allowances are examples, not measured estimates for your task.
Keep credentials, prompts, private suites and run records outside Git.

A pilot limits file contains `schemaVersion`, `expiresInMinutes`, `maxModelCalls`, `activeMinutes`, `maxRepairs` and `maxRevisions`.
Unknown fields and mixed file/individual flags are rejected. Expiry cannot exceed 24 hours.
Authorisation freezes effective values and the file digest; later file edits do not expand a run.

`expiresInMinutes` must include your time to review the specification and the time for each later stage.
You cannot extend an authorisation. After the expiry, you can only cancel the run, and a charged call is not refunded.

Token allowances remain in the project's `modelExecution.budget`. Strict token caps are unsupported.

## Configure and approve billing policy

### Host configuration

Clone `OWNER/CONTROL_REPO` privately, outside candidate workspaces. Replace
the example paths with reviewed absolute paths:

```sh
aegean configure \
  --control-remote git@github.com:OWNER/CONTROL_REPO.git \
  --verifier-checkout /absolute/private/checkout \
  --exclude /absolute/excluded/root
```

Include every sensitive, parked, third-party and production root in the exclusions.
Repeat `--exclude PATH` for each root. Initial configuration requires at least one.
Relative paths resolve from the current directory; duplicate paths are removed.

After installation of a version with additive configuration, add exclusions with:

```sh
aegean configure --exclude /absolute/excluded/root --exclude /another/excluded/root
```

This command preserves host identity, billing acknowledgement, existing exclusions,
control remote and verifier checkout. Conflicting remote or checkout options fail.
The command never removes exclusions. Removal requires deliberate review of host
settings. Missing path policy blocks enrolment; symlink aliases resolve to real
paths. `/srv` remains excluded.

Configuration uses a short atomic lock at `~/.local/state/aegean/configuring/`.
If interruption leaves the lock, inspect `owner.json`. Confirm the process stopped
before removal of that marker and a retry. If the owner record is absent or
uncertain, stop and investigate. Never delete `settings.json` or reset the host
identity to clear a lock. Concurrent callers fail instead of losing exclusions.

### Subscription policy

Before model execution, verify that paid overflow or extra usage is disabled in
both provider accounts. Then set `billingConfirmed` to `true` in
`~/.local/state/aegean/settings.json`.

An agent answer cannot supply this acknowledgement. Aegean rejects API keys,
alternate-provider variables and paid fallbacks. Authentication checks make no
model calls.

Use `aegean auth status` for a check without model calls.
The historical host-Builder smoke script is retired. Native qualification and live pilots use the VM boundary and need separate approval.

### Project eligibility

Do not enrol further real projects while the containment requirement remains
unmet. [Status](STATUS.md) records existing enrolment and the next trial decision.

For an authorised eligible project, `aegean.json` is its reviewed contract.
It declares schema and standard versions, the GitHub repository, public check
argument arrays and a digest-pinned CLI verifier. Enrol it with:

```sh
aegean enrol --config /path/to/reviewed-config.json
```

Inspect the resulting diff before a commit. The project's verifier image must
match `toolchain.json`. The legacy host `image` field is accepted but unused;
new configuration does not write it. Unsupported images fail before a lease or
model call. Verification never pulls images or installs dependencies.

Candidate commands use the fixed VM image and restricted tool bridge. Public checks
use a read-only candidate mount. Dependencies must already exist in the accepted image or candidate.
Host Git also rejects unsafe executable configuration;
see [execution boundaries](ARCHITECTURE.md#execution-boundaries).

## Run lifecycle

The full workflow remains unaccepted. The commands below describe its checkpoints;
they do not grant permission for a trial or bypass readiness checks.

### Use the interactive guide

At a terminal, start the guide in the root folder of the enrolled project:

```sh
aegean guide
```

`aegean` without arguments at a terminal also starts the guide. The guide asks a question for each step.
Select an answer with the arrow keys or a number, then press Enter. You do not copy a command or a run ID.
The guide uses colour if the terminal supports it. To show plain text, set `NO_COLOR=1`.

The guide does these steps in sequence:

1. It checks the host with `doctor`. For a failed login, a stopped verifier or missing qualification evidence, it offers the command that corrects the check.
   For qualification, that command is `aegean qualify`. The guide then checks the host again.
2. It reads the runs. If this host has an unfinished run, you can continue that run.
3. It checks the project and lists the committed files that the Scout reads.
4. It takes the request from a file, or it opens your editor (`VISUAL` or `EDITOR`) on a new private request file.
5. It prepares the run. If the release has no full acceptance, it asks for the pilot limits and starts the authorisation.
6. It starts the Scout draft. Then it shows the review summary and the specification folder.
7. At the specification review, you can read each file, open the folder in your editor, record your edits, approve or cancel.

For each run, the guide shows the minutes that remain in the pilot authorisation. Below 15 minutes, this line is a warning.

The guide opens a specification file in your pager (`PAGER`, or `less`). Press `q` to close the file.
The file list then shows the next file, and it marks each file that you opened.
If the pager cannot start, the guide prints the file and waits for your answer.

If the review notes contain an open question or a `NOT COVERED` need, the guide shows a warning that the draft is not complete.
The approval choice shows the counts, and the guide asks one more question before the approval prompt.
To remove an item, correct the specification, then remove the question or change the coverage entry in `review-notes.md`, and record the edit.

The guide runs the same commands as the sections below, and it prints each command before the command runs.
It adds no permission and replaces no check. You type each authorisation and approval confirmation yourself.
After the specification approval, the first choice stops the guide. The later stages use the commands in this document.

The guide keeps two private files under `~/.local/state/aegean/`: the requests that you write in `requests/`, and the last limits that you entered in `pilot-limits.json`.
Press Ctrl-C to stop the guide. The run keeps its state, and `aegean guide` continues it.
The guide needs an interactive terminal. An agent must not operate it; a pipe or a script gets a failure and no effect.

Tested: the synthetic suite and pseudo-terminal sessions with synthetic text. One real pilot project run used the earlier guide, to the specification review.
No real run used the pager, the remaining-time line or the warning for a draft that is not complete.

### Prepare the project and the request

Aegean works in an existing GitHub repository that you enrolled. It does not create a repository.
A run exists only after `aegean prepare`. Before that command, `resume`, `approve` and `status --run` have no run to use.

The Scout reads only these inputs:

- the request file;
- the check commands and the verifier command from `aegean.json`;
- the committed `README.md`, `.gitignore` and each `AGENTS.md` and `CLAUDE.md`;
- each committed path in `modelExecution.task.paths` and `modelExecution.task.dependencies`;
- for task class `unknown`, committed source files while space remains.

The agents cannot read other folders on your computer. If the agents need background, commit it as a project document.
Add its path to `modelExecution.task.paths`. Do not commit private data; commit a description of the data.

A rule in the project `AGENTS.md` limits the Scout. Remove rules that are no longer correct before a run.
Write the goal, the limits and the tests of success in the request. The Scout proposes the design.

### Specification and approval

The [interactive guide](#use-the-interactive-guide) does the steps in this section for you. The commands are:

From the prepared project's clean, reviewed main revision, check the configuration:

```sh
aegean project check --json
```

This reads configuration and Git identity without executing project commands or allocating a run.
It rejects old schemas and missing budgets. Image compatibility does not prove that project executables or dependencies exist in the verifier.

The `agentContext` field lists each committed file that the Scout will read, with its size. Check this list before you prepare a run.
A missing or oversized required file fails this command before a run exists.

A project keeps the `standardVersion` that you reviewed. A release accepts each version from `minProjectStandard` to `policy` in `toolchain.json`.
You edit `standardVersion` only when a release raises `minProjectStandard`; the command then names the accepted versions.
Review configuration changes through the project's own workflow before a run.

Prepare the request without a model call:

```sh
aegean prepare --request /absolute/path/to/request.md
```

The result contains the run ID. Repeated preparation returns the existing unfinished run or a specific recovery conflict.
Use that ID and your reviewed limits file:

```sh
aegean authorize-pilot --run RUN_ID --limits /absolute/path/to/pilot-limits.json
aegean resume --run RUN_ID
```

Answer the exact authorisation prompt yourself. The prompt shows the effective limits and project token allowances.
One run has one authorisation. If you repeat the command with the same limits, it reports the saved authorisation and asks nothing.
Different limits, or an expired authorisation, need a new run.

Native prerequisites must pass. Without full release acceptance, scoped pilot authorisation is required before the first model call.
`prepare` and `authorize-pilot` do not call models. `resume` executes the authorised stage.
The existing `start --request FILE` remains available; it prepares a run and immediately attempts resume.

Console diagnostics are captured automatically. Read the printed run and log paths; do not add a tee pipeline around human decisions.

The default approval mode is `local`. It stops after the specification draft without a GitHub push.
The result gives the `specification` folder, a `review` summary and the `next` commands.

Read `review-notes.md` in that folder first. It contains:

- each project rule that limited the request;
- the open questions that you must answer;
- the request coverage, where `NOT COVERED` marks a need that the draft omits;
- how the project checks prove the deliverable.

The Scout writes these notes. They are not verification evidence. If a project rule or the request is wrong, cancel the run.
Then correct the project on main and prepare a new run.

Also read `allowed-paths.txt` in the same folder. It lists each path that the Builder may create, change or delete.
An entry that ends with `/` allows each file below that directory. Lines that start with `#` are comments.

Verification fails if the candidate changes a path that the file does not allow. The Scout sees only a few project files,
so check that the list includes the test files and the files that the project checks read or write. Edit the file before approval if the list is wrong.

While the run is `spec-drafted`, `aegean status --run ID` gives a `review` field. It reads the open questions and the `NOT COVERED` entries from `review-notes.md` as the file is now.
The `aegean approve` prompt states their counts after the specification change. Aegean does not refuse the approval; the decision stays with you.

If a model answer does not have the required format, the run pauses and the call stays charged.
The pause reason names the fault and the fields, for example `invalid response (fields: coverage)`. It never contains model text.

Before approval, edit only `openspec/changes/RUN_ID/` in the isolated worktree.
Run `aegean resume --run ID` to record a revised draft.
The human then runs:

```sh
aegean approve --run ID
aegean resume --run ID
```

The terminal decision binds the exact specification and configured human identity.
Agents must not answer the confirmation prompt.
Explicit `github-comments` policy retains exact published specification approval comments.
Do not switch modes within a run.

The reviewed project configuration also needs an explicit model budget and task scope.
See [model use and token allowances](MODEL-USAGE.md) for fields, enforcement limits and recovery.

### Verification and publication

The Auditor creates protected tests before the Builder writes code. Verification
and a fresh independent review must pass before publication approval.

Before the first build, the verifier runs the protected tests once on the unchanged base commit.
The run folder records the result in `baseline.json`. `aegean status --run ID` shows it in the `baseline` field,
and the publication summary repeats it. A requirement whose tests already passed on the base commit has no evidence that the change works.

If every protected test passes on the base commit, the run stops before the Builder starts.

An inconclusive check uses the same infrastructure retry budget as candidate verification.
If a retry remains, the run pauses; correct the verifier, then resume. The Auditor is not called again.
If no retry remains, the run stops with `infrastructure retries exhausted`.

Verification first compares the changed paths with `allowed-paths.txt`. A change to another path fails
verification before the protected tests run. The Builder then gets a repair that names those paths.

Repair feedback contains public requirement identifiers and their approved text, the paths outside
`allowed-paths.txt`, and the review findings that the reviewer assigns to the Builder. Suite schema 2 refers to
public `### Requirement:` headings. Hidden inputs, expected results, actual outputs and test Auditor text stay private.

The independent reviewer gives each finding one owner. The owner decides what happens next:

| Owner | Meaning | Result |
| --- | --- | --- |
| `builder` | A defect in the code that the Builder can correct within the contract. | A repair, until the repair limit. |
| `spec` | The approved contract is wrong, incomplete or contradicts itself. | The run stops: `independent review found a specification fault`. |
| `factory` | A fault in Aegean, for example a protected test or the verifier. | The run stops: `independent review found an Aegean fault`. |

A stopped run uses no repair. `aegean status --run ID` names the review file with the findings.
The finding owner takes precedence over the review outcome, including `pass`. Publication review requires no findings.
For a specification fault, correct the request or the project guidance, then prepare a new run.
For an Aegean fault, record it in [pilot notes](PILOT-NOTES.md) and correct Aegean through a reviewed pull request before a new run.

Required context that exceeds its limit pauses the run. Optional Scout source has an explicit omission record.
A diff over 200,000 bytes pauses the run; partial review cannot produce a pass.

For local approval, inspect the terminal summary and private candidate patch.
Review the repository's CI, runners and deployment exposure. The human then runs:

```sh
aegean publish --run ID
```

This command confirms the exact verified and reviewed candidate, then attempts publication.
The human still decides whether to merge.
Explicit `github-comments` policy retains its separate publication comment.

For an edited candidate at human review, use the appropriate revision command:

```sh
aegean revise --run ID --scope implementation
aegean revise --run ID --scope contract
```

Choose one scope for the actual revision. Implementation changes require fresh verification and review.
An implementation revision can change only the paths in `allowed-paths.txt`; Aegean refuses another path.
To change another path, add it to `allowed-paths.txt` and use `--scope contract`.
Contract changes also require new specification approval and a new protected suite.
Revisions retain all consumed time, calls and tokens.

### Status, interruption and completion

Use `aegean status` or `aegean status --run ID` to inspect state without a model
call. Status preserves durable run state if local accounting is unavailable.
The `next` field gives the commands for the current state. It is guidance; it grants no permission.

For a pilot run, the `pilot` field shows the expiry time and the limits. After the expiry, `next` tells you to cancel the run.
A failed command prints a `recovery` line that names the missing step where Aegean can identify it.
Use Ctrl-C to interrupt the call. Follow [recovery](#recovery) before further action.

Use `aegean cancel --run ID` only when the local run is not executing.
Cancellation must confirm resource cleanup before it releases ownership.
Cancellation also works for a run that an older policy created. Every other command for that run fails.

After independent confirmation of the human merge, Aegean archives OpenSpec in a
separate worktree. Only `openspec/` documentation changes can use that direct-main
path. Non-fast-forward pushes or server protection stop the step for review.
The coordinator never force-pushes or bypasses protection. Successful archival
releases the lease. Live archival recovery remains unverified.

Runs retain their complete policy identity. An incompatible resume fails before
execution; status and deliberate cancellation remain available. Old suite, run
and acceptance formats are not promoted automatically. See the
[release acceptance contract](ACCEPTANCE.md).

## Run records and debugging

Keep three records for every real run. Each has one owner and one location.

| Record | Owner and location |
| --- | --- |
| Coordinator records | Aegean writes `~/.local/state/aegean/runs/<run-id>/`. |
| Operator diagnostics | Aegean writes private files under `~/Library/Logs/aegean/`. |
| Run note | The session adds a reviewed entry to [PILOT-NOTES.md](PILOT-NOTES.md). |

Start, prepare, resume, cancel, recover and publish create diagnostic logs automatically.
The terminal prints the log path and a concise note summary. Add the observed result to the pilot notes through the repository workflow.
Logs contain structured command, stage, release, run, elapsed-time and failure-category records.
They deliberately exclude raw error text, prompts, authentication output and protected values; use private coordinator records for deeper diagnosis.

Each invocation retains at most four 5 MiB segments. Capacity exhaustion prints an omission notice.
Log creation failure blocks execution. A log write failure stops further model calls and preserves recovery state.
Directories use mode 0700 and files use mode 0600. Symlink destinations are rejected.
Human confirmation retains the terminal, and interruption retains the command's failure status.

Coordinator records include `run.json`, `request.md`, `pr-body.md`, per-role usage, effects, receipts, reviews, the patch and worktree.
Read these files; never edit them. Raw logs, prompts and run files stay outside Git.
Diagnostic logs are not acceptance evidence. Older releases still need the manual console capture described in their installed guide.

Completed role output is stored in private `effects/` records. The model CLIs still disable their own session persistence.
Usage records have stable effect identifiers. `model-budget.json` owns reservations and settlement.
`contexts/` records supplied byte counts, hashes and source omissions. It does not claim complete provider input counts.
All these records stay outside Git and outside Builder access.

## Recovery

Inspect status and private records before a retry. Never delete ownership or
resource records to force progress.

| Problem | Action |
| --- | --- |
| Authentication or quota | Restore subscription access. If usage is unknown, reconcile the effect before another call. Never substitute API credentials. |
| Oversized review | Split the request or use a reviewed adapter. Repeated resume cannot turn an incomplete review into a pass. |
| Uncertain push result | Read the remote revision and event IDs before a retry. A lost response does not prove the action failed. |
| Another host owns the run | Stop. Recovery or transfer requires an operator decision; no timeout permits takeover. |
| Dependency drift | Reinstall from the reviewed manifest and repeat acceptance. |

### Process crash or retained lock

Inspect the owning host and prove that its child processes stopped. Then run:

```sh
aegean recover --run ID --confirm-stopped
```

Recovery rejects a live coordinator. It also rejects a lock with no owner record,
which can mean that a process has just started. An absent owner record needs a
separate process audit. Never race a new process by deleting its marker.
Read status before an explicit resume.

### Verifier cleanup

Aegean records container and export intentions before execution. Failed cleanup
retains the record and pauses the run. Resume, recovery and cancellation must
resolve it before further execution or ownership release.

Restore Docker, inspect the private receipt and retry. Do not discard the resource
record. Deliberate cancellation releases the lease only after confirmed cleanup.

### Upgrade or rollback

After explicit approval, upgrade from the reviewed checkout:

```sh
aegean upgrade --source /path/to/reviewed/checkout
```

Inspect the new `doctor` output before a run. `aegean rollback` selects the prior
release and regenerates its managed guidance. It preserves unrelated instructions.
A different release needs evidence for its exact installed identity.

Keep raw run files private and outside Git. Delete only a named completed run
after review of its evidence retention needs. Never automatically delete active runs.

Keep unrelated project records and instructions outside this checkout.

## Control migration

The human can inspect and confirm legacy control migration with `aegean migrate-control --approver LOGIN`.
Migration rejects active legacy ownership and preserves run records. Repeated migration leaves the migrated ledger unchanged.
Policy changes do not migrate an existing run automatically. Use its compatible release or cancel it.

## Uninstall and reinstall

Uninstall removes the managed command and skill links, removes only Aegean's managed instruction blocks, and archives the installation.
It preserves private state, host exclusions, run records, evidence, provider authentication, external runtimes and the Colima disk.
It does not reset a run, enable readiness or delete unrelated configuration.
An older ledger must have no owner and only terminal runs; uninstall checks this without migration.

After you finish or recover all active work, run:

```sh
aegean uninstall --confirm
```

For an older release without this command, build the reviewed source and run:

```sh
./scripts/dev build
mise exec -- node scripts/uninstall.mjs --confirm
```

The command prints the backup path under `~/.local/share/aegean-backups/`.
A private journal at `~/.local/share/aegean-uninstall.json` supports interrupted retries and blocks installation while uninstall is incomplete.
If the managed command is absent after interruption, repeat the source command above.
Do not edit the journal or delete an owner marker to force progress.

To install again from a clean, committed and reviewed source checkout:

```sh
sh scripts/bootstrap.sh
aegean info --json
aegean auth status
aegean doctor --require prerequisites
```

If `aegean status` reports a legacy ledger, run `aegean migrate-control --approver YOUR_GITHUB_LOGIN` and review its terminal prompt.
This migration is a separate human decision and preserves control history.
The retained state does not qualify a different release. After approval, run `aegean qualify` for its native prerequisites.
A real pilot and full acceptance remain separate steps. Preserve the uninstall backup until the new installation passes your checks.
