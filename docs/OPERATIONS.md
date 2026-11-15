# Installation, use and recovery

[Documentation](README.md) · [Status](STATUS.md) · [Architecture](ARCHITECTURE.md)

Aegean remains under trial. Read [current status](STATUS.md) before any installation
or run. Installation, live trials and release acceptance require explicit approval.
The procedures below describe the bootstrap workflow on `main`.
The bounded CLI source in PR #2 changes installation, ownership, approvals and
acceptance. See [source and installed versions](ENGINEERING.md#source-and-installed-versions) before use.
Use the guide path from the installed `aegean doctor --json` for live operations.

[Install](#install-on-either-mac) · [Configure](#configure-and-approve-billing-policy) ·
[Run](#run-lifecycle) · [Record evidence](#run-records-and-debugging) · [Recover](#recovery)

## Install on either Mac

### Before installation

1. Use the host's own GitHub, Claude and ChatGPT logins. Do not copy authentication
   files between machines.
2. Clone the private `you1anna/aegean` repository and review the intended commit.
3. Read [AGENTS.md](../AGENTS.md) and [STATUS.md](STATUS.md).
4. Inspect the host configuration. Preserve unrelated instructions and excluded paths.
5. Confirm explicit approval to install that version.

The bootstrap implementation is on `main`. A merged change does not update the
installed release or establish readiness. Each Mac needs its own evidence.

[toolchain.json](../toolchain.json) owns the required versions. Claude Code must
already be installed with subscription authentication. Colima and the Docker
client must match the declared versions. Missing or different versions stop
installation for review.

### Install the reviewed version

From a clean, committed checkout, run:

```sh
sh scripts/bootstrap.sh
~/.local/bin/aegean doctor --json
```

The bootstrap installs pinned Node through mise, installs locked packages with
lifecycle scripts disabled, runs checks and installs a versioned release.
It can install mise through Homebrew if mise is absent. It also configures the
dedicated Colima verifier through `scripts/setup-verifier.mjs`.

Codex and OpenSpec live inside the release. The installer copies the existing
Claude binary into the release. It leaves the ordinary Claude installation and
the desktop app unchanged.

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

For an approved native diagnostic, use the managed runtime:

```sh
mise exec -- node scripts/probe-builder.mjs
```

Homebrew Node can require external libraries that the filesystem policy correctly
rejects. Do not broaden the policy to make that runtime pass.

The verifier uses a dedicated Colima profile and a pinned image. Keep the user's
other Docker context selected; Aegean names its context explicitly. Never expose
the host home or Docker socket to candidate code.

VM resources come from [toolchain.json](../toolchain.json). Candidate limits come
from [the verifier adapter](../src/adapters/verifier.ts): 1 CPU, 512 MiB of memory,
64 processes and 15 seconds per case.

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

After confirmation and approval for the exercise, run the subscription smoke check:

```sh
mise exec -- node scripts/smoke-subscriptions.mjs
```

It tests the installed release with one small call per provider, capped at
90 seconds each. Codex must create an exact synthetic file with restricted tools.
Claude must return valid JSON with tools disabled.

The script rejects unconfirmed billing or absent subscription authentication.
It removes its temporary workspace and keeps private receipts under
`~/.local/state/aegean/acceptance-evidence/`. It never enables full readiness.

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

The current Builder profile cannot read npm's library directory. Public checks
use a read-only candidate mount. In-place npm builds need a reviewed adapter.
Host Git also rejects unsafe executable configuration;
see [execution boundaries](ARCHITECTURE.md#execution-boundaries).

## Run lifecycle

The full workflow remains unaccepted. The commands below describe its checkpoints;
they do not grant permission for a trial or bypass readiness checks.

### Specification and approval

Capture console output as described under [run records](#run-records-and-debugging).
Then start the approved request from its enrolled project:

```sh
aegean start --request /path/to/request.md
```

This creates a run and isolated worktree, drafts the specification and opens a
draft pull request. It uses a model and writes to GitHub. Specification drafting
can succeed while later implementation remains blocked by release acceptance.

Before approval, edit only `openspec/changes/RUN_ID/` in the isolated worktree.
Resume with `aegean resume --run ID`. Each revision is committed, pushed and
shown in the pull request body. The committed specification must match local
files, including files that Git would otherwise ignore.

The human approves the exact published revision with this comment:

```text
/aegean approve-spec SPEC_HASH SPEC_COMMIT
```

After approval, a contract change requires cancellation and a new run. Evidence
does not transfer silently to a changed contract.

### Verification and publication

The Auditor creates protected tests before the Builder writes code. Verification
and a fresh independent review must pass before publication approval.

Repair feedback contains only public requirement identifiers and their approved
text. Suite schema 2 refers to public `### Requirement:` headings. Hidden inputs,
expected results, actual outputs and arbitrary Auditor prose stay private.

Oversized Scout input is omitted with an explicit count. A diff over 200,000 bytes
pauses the run; partial review cannot produce a pass.

After verification and review, inspect the private `publication-review.md` and
`candidate-review.patch` files. Review the repository's CI, runners and deployment
exposure. Then post the exact command shown in the review:

```text
/aegean approve-publish COMMIT SPEC_HASH SUITE_HASH RECEIPT_HASH
```

The coordinator checks the human owner's comment before the candidate push.
Absent or stale approval leaves the remote at the specification revision.
Publication approval is separate from the human decision to merge.

### Status, interruption and completion

Use `aegean status` or `aegean status --run ID` to inspect state without a model
call. Use Ctrl-C to stop the active child process group. The detached-process
limit still applies; follow [recovery](#recovery) before further action.

Use `aegean cancel --run ID` only when the local run is not executing.
Cancellation must confirm resource cleanup before it releases ownership.

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
| Console capture | the operator writes `~/Library/Logs/aegean/<project>-<date>.log`. |
| Run note | The session adds one short entry to [PILOT-NOTES.md](PILOT-NOTES.md). |

Coordinator records include `run.json`, `request.md`, `pr-body.md`, per-role
`usage/` and `effects/`, verification receipts, reviews, the patch and the worktree.
Read these files; never edit them. `aegean status --run ID` reads the same state.

Aegean prints errors to the terminal. Capture every real `start`, `resume`,
`cancel` and `recover` command. Create the private log directory first:

```sh
mkdir -p ~/Library/Logs/aegean
chmod 700 ~/Library/Logs/aegean
```

For example, after you assign the intended run ID to `RUN`:

```sh
log=~/Library/Logs/aegean/project-$(date +%F).log
{ date -u +%FT%TZ; aegean resume --run "$RUN"; echo "exit $?"; } 2>&1 | tee -a "$log"
```

Keep all three records private. Raw logs, prompts and run files stay outside Git.
Run notes contain identifiers, outcomes and paths, never copied log content.

**Known diagnostic limit, observed 14 November 2026:** role sessions disable
persistence with `--no-session-persistence` and `--ephemeral`. No code saves a
role's raw output. A failed role leaves its name, duration, exit code and token
counts in `usage/`, plus any console capture.

Persistent private role diagnostics remain proposed work. Any implementation
must keep protected test content outside Builder access.

## Recovery

Inspect status and private records before a retry. Never delete ownership or
resource records to force progress.

| Problem | Action |
| --- | --- |
| Authentication or quota | Preserve the run. Restore subscription access, then resume explicitly. Never substitute API credentials. |
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
