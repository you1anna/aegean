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

The installed command is under `~/.local/bin`. If that folder is not on PATH,
use the absolute command above. Skills live in `~/.agents/skills/aegean` and
`~/.claude/skills/aegean`. Managed guidance blocks are added to user instructions,
with backups. Existing sessions may need restarting for skill discovery.

Run native diagnostics through the managed runtime:
`mise exec -- node scripts/probe-builder.mjs`. An ambient Homebrew Node can depend
on dynamic libraries outside the deliberately restricted filesystem policy.

The bootstrap also verifies the declared Colima/Docker versions and runs
`scripts/setup-verifier.mjs`. A version mismatch stops installation for review;
it does not upgrade unrelated projects. The verifier uses a dedicated profile, with only a candidate-export
directory mounted, and a pinned container image. Do not expose the Docker socket
or the operator's home to a candidate. Runtime defaults are 2 CPUs, 2 GiB VM
memory; each candidate has 1 CPU, 512 MiB, 64 processes and a 15-second limit.
Keep the user's other Docker context selected; Aegean names its context explicitly.

## Configure and approve billing policy

Clone `OWNER/CONTROL_REPO` privately outside candidate workspaces. Configure:

```sh
aegean configure --control-remote git@github.com:OWNER/CONTROL_REPO.git --verifier-checkout /absolute/private/checkout --image node@sha256:VERIFIED_DIGEST
```

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

## Run lifecycle

`aegean start --request /path/to/request.md` creates a run and isolated worktree,
drafts the specification and opens a draft PR. The operator comments exactly
`/aegean approve-spec HASH` on that PR. `aegean resume --run ID` independently
checks the comment and the specification hash before continuing.

The installed bootstrap refuses implementation until release-specific acceptance
is recorded. It is not sufficient to flip a readiness flag: retain passing
native isolation, protected-verifier and live-loop evidence for the installed
source hash. Production acceptance remains pending until both Macs and a real
pilot pass. Review docs/STATUS.md for the actual evidence.

`aegean status` makes no model calls. `aegean cancel --run ID` is permitted only
when the local run is not executing. Ctrl-C stops the running child process group.
The coordinator never merges a PR. After independently confirming the human
merge, it runs OpenSpec archival in a separate worktree and permits only
`openspec/` documentation changes through the lightweight direct-main path.
Non-fast-forward pushes or server protection stop that step for review; nothing
force-pushes or bypasses repository protection. A successful archive releases the
lease. Archival recovery still requires a live acceptance exercise.

## Recovery

- Authentication/quota problems: preserve the run, fix subscription access, then
  resume explicitly. Never introduce API credentials to get around a limit.
- Process crash: inspect the owning host and prove its child processes stopped
  before removing that run's `executing` marker. Read remote status before retrying.
  A marker is not a timeout-based permission to take over.
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
