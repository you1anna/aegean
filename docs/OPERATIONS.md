# Installation, use and recovery

## Install on either Mac

Clone the private `you1anna/aegean` repository using that host's own GitHub login.
Do not copy authentication files from another machine. Review the checkout, then:

```sh
sh scripts/bootstrap.sh
~/.local/bin/aegean doctor --json
```

During bootstrap, review the `bootstrap-v1` branch: `main` contains only the
initial scope documentation until the human-reviewed PR is merged. A secondary host-local
session should read `AGENTS.md` and `docs/STATUS.md` before running the bootstrap,
inspect its existing configuration, and preserve unrelated instructions. It must
use the secondary host's own Claude, ChatGPT and GitHub logins. the primary host's successful checks
are not evidence that the secondary host is ready.

The bootstrap installs pinned Node through mise, installs locked packages with
lifecycle scripts disabled, runs checks and installs a versioned release. Claude
Code 2.1.322 must already be installed and signed in with a subscription. Its
binary is copied into the release; ordinary Claude installation is left intact.
Codex 0.167.2 and OpenSpec 2.0.0 are release-local. The desktop app is not modified.

The installer requires clean committed source, including nonignored untracked
files. It exports the recorded commit and rebuilds in an empty staging directory;
ignored or stale development `dist/` files cannot enter the release. The installed
manifest binds the source commit/tree, compiled output, every shipped file/link
and executable mode, and the external Node executable. Never hand-copy changes
into a release. See [acceptance identities](ACCEPTANCE.md).

The installed command is under `~/.local/bin`. If that folder is not on PATH,
use the absolute command above. Skills live in `~/.agents/skills/aegean` and
`~/.claude/skills/aegean`. Managed guidance blocks are added to user instructions,
with backups. Existing sessions may need restarting for skill discovery.

Run native diagnostics through the managed runtime:
`mise exec -- node scripts/probe-builder.mjs`. An ambient Homebrew Node can depend
on dynamic libraries outside the deliberately restricted filesystem policy.

The bootstrap also verifies the declared Colima/Docker versions and runs
`scripts/setup-verifier.mjs`. A version mismatch stops installation for review;
an absent executable also stops without installing an unpinned Homebrew package.
Install the reviewed pinned version explicitly. The verifier uses a dedicated profile, with only a candidate-export
directory mounted, and a pinned container image. Do not expose the Docker socket
or the operator's home to a candidate. Runtime defaults are 2 CPUs, 2 GiB VM
memory; each candidate has 1 CPU, 512 MiB, 64 processes and a 15-second limit.
Keep the user's other Docker context selected; Aegean names its context explicitly.

## Configure and approve billing policy

Clone `OWNER/CONTROL_REPO` privately outside candidate workspaces. Configure:

```sh
aegean configure --control-remote git@github.com:OWNER/CONTROL_REPO.git --verifier-checkout /absolute/private/checkout --exclude /absolute/excluded/root
```

`toolchain.json` owns the supported verifier image. A project's image must match;
unsupported images fail before acquiring a lease or invoking a model. The legacy
host `image` field is accepted but no longer written or used. Verification never
pulls images or installs application dependencies.

Repeat `--exclude PATH` for each reviewed excluded root. Initial setup requires
at least one; relative paths are resolved from the current directory and duplicate
paths are removed. Existing hosts can add or migrate exclusions after installing
this reviewed version:

```sh
aegean configure --exclude /absolute/excluded/root --exclude /another/excluded/root
```

This adds to `excludedRoots`, preserving host identity, billing acknowledgement,
existing exclusions, control remote and verifier checkout. Conflicting remote or
checkout options are rejected. Removing an exclusion requires deliberate review
of host settings; this command never removes one. Preserve the host's existing
sensitive, parked, third-party and production exclusions. Missing policy fails
closed. Symlink aliases resolve to real paths during eligibility checks;
`/srv` remains excluded. Personal folder names no longer live in application
source; this does not remove names from existing private Git history.

Configuration writes use a short atomic lock at
`~/.local/state/aegean/configuring/`. If it remains after interruption, inspect
`owner.json` and confirm no configuring process is running. Only then remove that
marker and retry; do not remove `settings.json` or reset the host identity. If the
owner record is missing or its state is uncertain, stop and investigate instead
of assuming the lock is stale. Concurrent callers fail closed and may retry once
the active writer completes; no exclusion is silently overwritten.

Before model execution, the operator must verify that paid overflow/extra usage
is disabled in both provider accounts and set `billingConfirmed` to true in
`~/.local/state/aegean/settings.json`. This acknowledgement is never inferred
from an agent answer. API keys, alternate-provider variables and paid fallbacks
are rejected. Authentication checks make no model calls.

After that confirmation, `mise exec -- node scripts/smoke-subscriptions.mjs`
tests the currently installed release using one small call per provider. Each
call is capped at 90 seconds. Codex must create an exact synthetic file using
its restricted tools; Claude must return valid JSON with tools disabled. The
script refuses unconfirmed billing or missing subscription authentication,
cleans its temporary workspace and keeps private receipts under
`~/.local/state/aegean/acceptance-evidence/`. It never enables full readiness.

`aegean.json` is a reviewed project contract: schema version, standard version,
GitHub owner/repository, public check argv arrays and a digest-pinned CLI verifier.
Run `aegean enrol --config /path/to/reviewed-config.json`, inspect its diff and
commit it. This initial adapter cannot install application dependencies online.
It also rejects executable Git filters, custom diff converters, candidate-writable
config includes and unsupported credential/transport helpers. The coordinator
suppresses hooks, signing, filesystem monitors and automatic maintenance for
candidate Git operations; the Builder's own sandbox cannot protect host Git.

The current Node-only Builder profile cannot read npm's library directory. Public
checks also use a read-only candidate mount. In-place npm/build workflows need a
separately reviewed adapter. Detached subprocess containment is a known unresolved
release blocker; do not enrol real projects or mark native isolation accepted.

## Run lifecycle

`aegean start --request /path/to/request.md` creates a run and isolated worktree,
drafts the specification and opens a draft PR. The operator comments exactly
`/aegean approve-spec SPEC_HASH SPEC_COMMIT` on that PR. Before approval, edit
only the isolated worktree's `openspec/changes/RUN_ID/` files and resume. Every
revision is committed, pushed and displayed in the PR body. The committed spec
tree must match local content, including files otherwise ignored by Git. The
human comment must bind that exact published revision. After approval, v1 requires
cancelling and starting a new run for contract changes; evidence is never silently
reused for a changed contract.

After passing verification and independent review, Aegean writes private local
`publication-review.md` and `candidate-review.patch` files. Review the candidate
and the repository's CI/runner/deployment exposure, then post the command shown:
`/aegean approve-publish COMMIT SPEC_HASH SUITE_HASH RECEIPT_HASH`. Aegean checks
the human owner's exact comment before pushing candidate code. Withheld or stale
approval leaves the remote at the spec revision. This is separate from final
human merge approval. No command posts an approval on the human's behalf.

Protected suite schema 2 exposes only IDs of public `### Requirement:` headings
to repair feedback; their text comes from the approved contract. Hidden inputs,
expected/actual output and arbitrary Auditor prose are not forwarded. Oversized
Scout input is omitted with an explicit count. A diff over 200,000 bytes pauses;
partial review cannot produce a pass.

Ordinary execution remains gated. [Release acceptance](ACCEPTANCE.md) defines
typed, hashed evidence for the exact installed release, both hosts and a real
pilot. Old three-boolean gates and old suite/run formats are not promoted to the
new format. Runs pin their complete policy identity; an incompatible resume fails
before execution, while status and deliberate cancellation remain available.

`aegean status` makes no model calls. `aegean cancel --run ID` is permitted only
when the local run is not executing. Ctrl-C stops the running child process group.
The coordinator never merges a PR. After independently confirming the human
merge, it runs OpenSpec archival in a separate worktree and permits only
`openspec/` documentation changes through the lightweight direct-main path.
Non-fast-forward pushes or server protection stop that step for review; nothing
force-pushes or bypasses repository protection. A successful archive releases the
lease. Archival recovery still requires a live acceptance exercise.

## Run records and debugging

Three records exist for a run. Each has one owner and one place.

- **Coordinator records**, written by Aegean in
  `~/.local/state/aegean/runs/<run-id>/`: `run.json`, `request.md`,
  `pr-body.md`, per-role `usage/` and `effects/`, verification receipts,
  reviews, the candidate patch and the worktree. Read them; never edit them.
  `aegean status --run ID` reads the same state without a model call.
- **Console capture**, written by whoever runs the command, in
  `~/Library/Logs/aegean/<project>-<date>.log` (directory mode 0700). Aegean
  prints errors only to the terminal, so capture every real `start`, `resume`,
  `cancel` and `recover`:

  ```sh
  log=~/Library/Logs/aegean/pilot project-$(date +%F).log
  { date -u +%FT%TZ; aegean resume --run "$RUN"; echo "exit $?"; } 2>&1 | tee -a "$log"
  ```

- **Run notes**, written by the session, in [PILOT-NOTES](PILOT-NOTES.md):
  one short entry per real run, pointing at the two records above.

Keep all three private. Raw logs, prompts and run files stay outside Git; the
notes carry identifiers, outcomes and paths, never copied log content.

Known limit, observed in source on 14 November 2026: role sessions run without
session persistence (`--no-session-persistence`, `--ephemeral`) and no code
writes a role's raw output to disk. A failed Scout, Auditor or Builder
therefore leaves its role name, duration, exit code and token counts in
`usage/`, plus whatever the console capture caught. Persisting bounded,
private role diagnostics is an open change; it must keep protected-suite
content outside Builder reach.

## Recovery

- Authentication/quota problems: preserve the run, fix subscription access, then
  resume explicitly. Never introduce API credentials to get around a limit.
- Process crash: inspect the owning host and prove its child processes stopped,
  then use `aegean recover --run ID --confirm-stopped`. Recovery rejects a live
  coordinator and an existing lock whose owner record is absent (it may still be
  initializing). An absent owner record requires a separate manual process audit;
  never race a starting process by deleting its marker. Read status before an
  explicit resume; no timeout permits taking over another host.
- Verifier cleanup: a durable container/export intent precedes execution. Failed
  cleanup preserves that intent and pauses. Resume, recovery and cancellation
  must reconcile it before further execution or releasing ownership. Restore
  Docker, inspect the private receipt and retry; do not discard the resource file.
- Oversized review: split the request or use a separately reviewed adapter.
  Repeated resume never turns an incomplete diff into a pass. Deliberate cancel
  releases the lease once process/container cleanup is established.
- Network uncertainty after push: read the remote revision and event IDs; do not
  repeat an external effect merely because its local response was lost.
- Another host owns the run: stop; recovery/transfer is operator-led. Never delete
  its lease while it might still run. Cross-host takeover is not automated in v1.
- Dependency drift: reinstall from the reviewed manifest and re-run acceptance.
- Upgrade: `aegean upgrade --source /path/to/reviewed/checkout`. Verify the new
  doctor output before starting jobs. `aegean rollback` selects the prior release
  and regenerates its managed guidance without overwriting unrelated instructions.

Keep raw run files private and outside Git. Delete only a named completed run
after reviewing its evidence retention needs; no automatic cleanup of active runs.
The prior repository and its dirty work remain in legacy-project. Never resume an
old previous capture project chat against the new Aegean checkout.
