# Design

## Context

See [proposal](proposal.md) for the problem and [requirements](specs/operator-commands/spec.md) for the contract.
The current bootstrap runs dependency installation, tests, VM setup and installation in sequence.
`package.json` owns build and test commands, but TypeScript output can retain obsolete files.
`runtime.ts` resolves installed binaries and readiness. `setup-verifier.mjs` owns VM setup, with pinned resources and explicit Docker context.
The engine currently allocates a run before it checks for missing model execution limits.
Pilot authorisation already binds exact identities through an interactive human decision.
These controls remain authoritative. The current main specification inventory is empty.

## Goals / Non-Goals

**Goals:** A small discoverable interface, reproducible source checks, useful diagnostics and safe repetition after failure.

**Non-goals:** A new scheduler, new approval policy, automatic project migration, smaller-model qualification or automatic release acceptance.
Do not modify pilot project or another project through this change.

## Decisions

### 1. Two entry points, with one owner for each operation

Use a thin POSIX launcher at `scripts/dev` for source tasks. Delegate to Node scripts through the existing pinned mise runtime.
Keep installed operations under `aegean`. A local checkout must not silently select its source as the active release.
Do not add Make, Just or Task dependencies. Optional future mise task aliases can delegate to the same script.
The source launcher prints help without Node, installs dependencies only for setup, and quotes all paths and arguments.
It does not run arbitrary command strings from configuration.

| Command | Result and side effects |
| --- | --- |
| `./scripts/dev help` | List source tasks and prerequisites; no mutation |
| `./scripts/dev setup` | Install pinned runtime and root/tools dependencies from lockfiles; no release or VM changes |
| `./scripts/dev build` | Remove only verified repository-owned compiled output, then build |
| `./scripts/dev check` | Check types and maintained script syntax; no install |
| `./scripts/dev test` | Clean build and full synthetic suite |
| `aegean info --json` | Active release path, commit, artifact identity, config paths and guide |
| `aegean doctor --require prerequisites` | Read-only diagnosis; nonzero unless prerequisites pass |
| `aegean doctor --require full` | Read-only diagnosis; nonzero unless full readiness passes |
| `aegean auth status` | Check both installed provider clients without model calls |
| `aegean auth login claude` | Run the installed Claude login interactively |
| `aegean auth login codex` | Run the installed Codex subscription login interactively |
| `aegean verifier status` | Inspect the dedicated profile, image and resource state |
| `aegean verifier start` | Start the existing reviewed profile; no implicit image pull or configuration replacement |
| `aegean verifier stop` | Stop only after ownership and cleanup checks; no force option |
| `aegean project check --json` | Validate config and base; report unsupported verifier commands without executing them |
| `aegean prepare --request FILE` | Create or reconcile a prepared run; no model calls |
| `aegean authorize-pilot --run ID --limits FILE` | Preview limits and obtain the existing exact human decision |
| `aegean resume --run ID` | Execute authorised stages with automatic private console capture |

Existing `start`, `approve`, `publish`, `qualify`, `upgrade`, `rollback` and recovery commands remain.
The maintained bootstrap remains the first-install route. Its steps delegate to shared source-task and verifier code where applicable.
Installation and first VM provisioning stay explicit. Routine verifier start reports the provisioning command if the profile or image is absent.
Doctor retains its current default JSON behaviour; `--require` adds opt-in exit checks.
New commands support scoped help and reject unknown flags before side effects.

### 2. Keep configuration ownership explicit

| File | Owner and purpose |
| --- | --- |
| `toolchain.json` | Runtime, provider, VM, image and policy pins |
| `mise.toml` | Source runtime selection; verification checks its Node pin against the toolchain |
| Root and tools `package-lock.json` | Dependency resolution; setup never rewrites them |
| Project `aegean.json` | Reviewed schema, approver, verifier, task scope and monitored token allowances |
| Private `~/.local/state/aegean/settings.json` | Existing host identity, exclusions, billing acknowledgement and control locations |
| Operator-selected `pilot-limits.json` | Reusable trial limits only; no credentials or approval |
| Installed `installation.json` | Release provenance; never edit manually |

Provide validated examples under `examples/` and a configuration reference in the operations guide.
Reuse existing domain budget validation; the new limits schema only owns file version and expiry duration.
Proposed limits file:

```json
{
  "schemaVersion": 1,
  "expiresInMinutes": 120,
  "maxModelCalls": 12,
  "activeMinutes": 60,
  "maxRepairs": 2,
  "maxRevisions": 2
}
```

These are sample allowances, not automatic defaults or guarantees about token use.
Convert duration to absolute expiry immediately before confirmation; enforce the existing 24-hour maximum.
Display project token limits beside the pilot limits. Reject combined file and individual limit flags.
Retain the frozen limits digest and effective values in the existing pilot record.
Never reread a changed file as permission to expand a run.

### 3. Reuse application logic and keep I/O at the edges

Extend the CLI dispatcher with small command handlers; do not embed business rules in shell scripts.
Share project preflight between check, prepare and start. Move required-budget validation before local state or ledger mutation.
Keep Git reads behind the candidate Git boundary. Report local and remote base differences without fetching into the candidate during read-only checks.
Extract preparation from the existing start path; retain start as preparation followed by resume.
Identify repeated preparation by host, repository, request digest, base and policy; reconcile durable intent before allocation.
Different unfinished matches produce a conflict with run IDs, rather than a guessed selection.
Retain the existing global Builder limit and repository permits. Do not introduce a second run database.

Host lifecycle commands use process adapters and reviewed manifests. Login retains the terminal and subscription-only restrictions.
Verifier stop coordinates with run admission through a short host transition reservation.
Do not hold metadata locks while a VM or provider process runs. Retain intent after interruption; reject new work until reconciliation.
Build tasks use a checkout-scoped lock for dependency and compiled-output mutations.
Never remove output through a symlink or delete an unverified path.

### 4. Bound logs and preserve human interaction

Add capture at the CLI/process edges for start, prepare, resume, cancel and recover.
Create private log directories with mode 0700 and files with mode 0600 before execution.
Use exclusive file creation and reject symlink targets. Keep prompts, authentication output, protected suite values and raw model events out of console capture.
Use structured diagnostics with release, run, stage, result and elapsed time; retain existing private effects as their own evidence owner.
Limit console logs to four 5 MiB segments per invocation, with visible rotation and omission markers.
Keep streaming buffers bounded. Do not copy logs to Git or treat them as acceptance receipts.
Preserve stdin for human confirmation, command exit status and signal propagation.
Report run and log paths plus a concise note template. The session still reviews and adds the pilot note through the repository workflow.

### 5. Documentation follows user tasks

README links to the local build and installed-use paths. CONTRIBUTING owns source checks; OPERATIONS owns host and pilot procedures.
Include the complete sequence: setup/check/test, inspect host, authenticate if needed, start verifier, check project, prepare, authorise and resume.
Show expected checkpoints, side effects, error recovery and configuration examples next to their commands.
Keep release evidence and dated qualification results in STATUS and PILOT-NOTES.
Review README and every directly linked guide under CONTRIBUTING's documentation rule.

### References and adaptations

- [mise tasks](https://mise.jdx.dev/tasks/): named tasks and explicit dependency order inform the source interface.
  Reuse existing mise rather than introduce another runner; do not use parallel mutation tasks.
- [uv lock and sync](https://docs.astral.sh/uv/concepts/projects/sync/): locked dependency checks inform repeatable setup.
  Aegean retains npm and its lockfiles; no Python dependency manager is added.
- [Homebrew commands](https://docs.brew.sh/Manpage): diagnostic and lifecycle commands inform discoverability and separation of side effects.
  Doctor remains read-only and installation remains a distinct operation.

These are design adaptations, not claims that those tools provide Aegean's approval or evidence guarantees.

## Risks / Trade-offs

- Wider CLI surface → retain existing commands, scoped help and tested examples; avoid aliases with separate implementations.
- Source build cleanup → validate ownership and paths; prove unrelated and symlinked files survive rejection tests.
- VM stop races → coordinate admission and preserve uncertain intent; no forced stop or stale-owner takeover.
- Repeated preparation → test every durable boundary and concurrent callers with real temporary Git remotes.
- Private logs → bounded capture and secret-exclusion tests; no raw provider output in operator logs.
- Host restrictions → distinguish unavailable access from absent authentication; verify manually in an authorised native Terminal exercise.

## Verification and capacity

Run locked dependency installation, type checks, script syntax checks and the full synthetic suite on the final source.
Test every rejection before mutation with counters for model calls, installs, VM actions and ledger writes.
Test repeated setup/start, concurrent preparation, stale policy, interrupted effects, log failure, exit propagation and unrelated configuration preservation.
Assert one global Builder and one execution permit per repository remain enforced.
Measure maximum log storage at 20 MiB per invocation and verify bounded memory under output flooding.
Test help and examples against synthetic executables; check local Markdown links and `git diff --check`.
Obtain independent review and protected verification through the approved execution route.
Native authentication, VM lifecycle and live pilot acceptance remain separate authorised exercises on the exact installed release.

## Migration Plan

1. Review and approve this specification and establish an authorised implementation route.
2. Implement and verify on an isolated branch without host mutations or live model calls in synthetic tests.
3. Submit the exact candidate for human review and publication approval.
4. After separate merge and installation approval, use the maintained installer.
5. Requalify the new release before a pilot; prior evidence does not transfer automatically.
6. Preserve previous release selection and host configuration for rollback; inspect run compatibility before a release change.

No host or project configuration is automatically migrated. Old project schemas produce a reviewable error and example guidance.

## Approved uninstall extension

The operator requested uninstall after source verification so he can test installation from a fresh baseline.
The maintained uninstall command archives the data directory and removes only validated managed links and instruction blocks.
It preserves host settings, run records, evidence, authentication, external runtimes and the VM disk.
A strict durable journal outside the installation supports retries after removal of the executable.
Installation refuses a pending journal. Uninstall refuses active or uncertain host ownership.
The operator receives the backup path and the maintained bootstrap command; this task does not install the new release.
