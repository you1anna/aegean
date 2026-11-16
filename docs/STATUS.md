# Status

[Documentation](README.md) · [Operations](OPERATIONS.md) · [Acceptance](ACCEPTANCE.md)

**Experimental. The full workflow is not accepted for ordinary use.**

## At a glance

Last host inspection: **15 November 2026**.

| Area | Last recorded result |
| --- | --- |
| Source | PR #1 and PR #2 are merged. The operator commands remain on `codex/local-operator-commands` for human review. |
| Installed release | the primary host had `0.1.0-3676d6ce572a` before the authorised uninstall. See the current record below. |
| Control history | Two cancelled bootstrap runs lack a later policy field. Read-only inspection accepts these records without changing them. |
| Ordinary implementation | Full release acceptance remains incomplete. Source tests do not establish native qualification. |
| secondary Mac | Installation and acceptance remain unverified. |

## 16 November 2026: Review of the specification and guidance code

A review of the code from PR #6 and the project standard fix found these weak points. All are corrected in source:

- The `project check` preview and the run built the Scout prompt separately, with different size limits. One function now builds both.
- Length limits on draft entries could fail a charged Scout call. The limits are wider, and the prompt states the wanted length.
- A pause after a bad model answer did not say what was wrong. The reason now names the fault and the fields, never model text.
- `status` sent the operator to `resume` after a pilot authorisation expired. It now shows the expiry and tells the operator to cancel.
- A first `authorize-pilot` made two control ledger round trips. It makes one again.
- Version order had two implementations. `scripts/cli-version.mjs` owns it.
- `doctor` printed a raw `ENOENT` for an absent acceptance record. It prints a plain sentence.

The tests are split by concern: `scout.test.ts` and `operator-guidance.test.ts`. No behaviour of an approval gate changed.
No live model call or installation occurred. The check results are in the pull request.

## 16 November 2026: Project standard range

PR #6 made each enrolled project edit `standardVersion` after the policy change. The manual step was removed.
The approval covers this fix directly on `main`, without a pull request or a pipeline run.

A release now accepts each project standard from `minProjectStandard` to `policy` in `toolchain.json`; both are `0.4.0` to `0.5.0` now.
A version outside that range, or a malformed version, fails `project check` with the accepted versions in the message.
New enrolment text no longer names a version. The type check and the operator command tests passed; the full suite did not run.
The release `0.1.0-312da915da1d` on the primary host does not contain this fix and still requires `0.5.0` exactly.

## 16 November 2026: Specification inputs and operator guidance

The second pilot project run reached `spec-drafted` with a draft that the operator could not approve.
[Pilot notes](PILOT-NOTES.md) record the run. The causes were in Aegean and in the project guidance.

Source changes, tested with synthetic fixtures only:

- The Scout now receives the committed `.gitignore` and the project check and verifier commands.
- The draft must contain a verification statement, request coverage, the project rules that limited the request and open questions.
  A draft without them, or without Requirement and Scenario headings, pauses the run. Aegean writes them to `review-notes.md`.
- `project check` lists the files that the Scout will read. A missing or oversized required file fails before a run exists.
- A repeated `authorize-pilot` with the same limits reports the saved authorisation without a prompt. It replaces nothing.
- `status`, the draft stop and failed commands name the next step.
- The policy version is `0.5.0` because context selection changed.

Not established: no live model call used the new prompt. The stricter draft format can pause a run after one charged Scout call;
the rate is unmeasured. Aegean does not check that the draft obeys the ignore rules or the check commands; the human reads the notes.
The installed release on the primary host is unchanged until a reviewed installation. Host qualification is necessary again after installation.

Checks on the final source with the pinned Node runtime: the type and script checks passed. The full suite ran 198 tests in 592 seconds;
197 passed. The one failure was a test that used `0.5.0` as its example of a changed policy version. That test now uses a version
that cannot equal the shipped one; its file was run again and passed. The 22 script tests passed. No live run or installation occurred.

Open items from the same session, not started: a managed method for private local context, a check for stale
enrolment text in a project `AGENTS.md`, and a plain message for the absent release acceptance file in `doctor`.

## 16 November 2026: Installation test reliability

This source fix used manual approval. No additional full pipeline run was performed.
Forced terminal colour reproduced the stopped-owner fixture failure: `console.log(number)` decorated the PID with ANSI codes.
The fixture now writes plain text and forces colour during its check. PID validation and live-owner rejection remain intact.
The source-task fixture now waits for a child readiness message instead of a fixed startup delay.

Bootstrap no longer repeats the development suite on each installation. Source provenance, type, script and artifact checks remain required.
Development and CI retain the full suite. See [testing](TESTING.md) for focused checks.

All 18 installation tests passed under forced colour in 25.52 seconds. All six source-script tests passed in 1.37 seconds.
The build, type check, bootstrap syntax check and diff check passed. No full-suite rerun or live installation occurred.

## 16 November 2026: Claude compatibility fix

The source accepts stable Claude versions within the range in `toolchain.json`.
Installation, authentication and doctor use the same rule. The copied version remains bound to the release artifact identity.
See [installation requirements](OPERATIONS.md#install-on-either-mac) for operation and reporting.

The regression reproduced rejection of Claude 2.1.323 before the fix.
After the fix, synthetic installation accepts that version and rejects old, prerelease and next-major versions.
Repeated installation preserves the existing release. The host's Claude 2.1.325 output also passes the compatibility rule.

Locked dependency installation, type checks, changed-script syntax checks, documentation links and `git diff --check` passed.
The full suite passed **212 tests, with no failures or skips**: 191 TypeScript tests and 21 script tests.
Durations were 613.41 seconds and 1.14 seconds. An earlier sandbox-blocked attempt was stopped and is not passing evidence.
These results cover synthetic behaviour. This change has no live installation, native qualification or release-acceptance evidence.
Publication and human PR review remain pending.

## 15 November 2026: Local operator commands

The operator approved the manual source-work exception used for PR #2, tests, independent review and removal of the current installation.
Installation and live qualification remain separate operator actions.
The [review record](OPERATOR-COMMANDS-REVIEW.md) describes the implementation, findings and corrections.
The [operations guide](OPERATIONS.md) owns the installation, configuration, recovery and pilot commands.

The source adds repeatable development commands, host checks, verifier lifecycle commands and preparation without model calls.
The uninstall command archives the installation and preserves private state, authentication and the verifier disk.
The approved compatibility fix preserves original terminal records without an invented policy identity.
Active legacy records and malformed records still fail validation.
Explicit control migration remains necessary after installation.

The live inspection found no owner, active execution or verifier containers.
It did not change control commit `8b5cc8c3744568a79910e225a1cfe9e88d51c004` or its two cancelled records.
No live model call, control migration, publication, merge or new release installation formed part of this work.

### Verification and uninstall result

- Locked dependencies, type checks and script syntax checks passed.
- The final suite passed **204 tests, with no failures or skips**: 191 TypeScript tests and 13 script tests.
- The suite durations were 623.19 seconds and 1.12 seconds, respectively.
- Strict OpenSpec validation, local documentation links, shell examples and `git diff --check` passed.
- Independent review found no remaining blocking source issue, including the approved compatibility fix.
- The maintained uninstall removed the managed command, skill links and routing blocks. The dedicated verifier is stopped.
- Post-uninstall checks confirmed the backup, unchanged host settings and unchanged control history.

The maintained uninstall retained a local recovery backup.

The first stop attempt rejected Homebrew Docker 29.9.3 before any VM change.
The successful stop used the existing pinned Docker 29.9.1 binary.
The follow-up passed 35 affected tests after correction of a stale compiled fixture in the full run.
See the [review record](OPERATOR-COMMANDS-REVIEW.md#fresh-install-docker-correction) for exact results.
The corrected bootstrap now downloads and verifies that client independently; the backup is only for recovery.
Run this single install command from the checkout:

```sh
sh scripts/bootstrap.sh
```

After installation, inspect authentication, migrate the historical control ledger explicitly and qualify the host:

```sh
~/.local/bin/aegean info --json
~/.local/bin/aegean auth status
~/.local/bin/aegean migrate-control --approver LOGIN
~/.local/bin/aegean qualify
~/.local/bin/aegean doctor --require prerequisites
```

The explicit migration preserves the cancelled history; uninstall did not migrate it.
Qualification and the bounded pilot remain unverified on the new release.
Use the [operations guide](OPERATIONS.md) for project checks, preparation, limits and authorisation before a feature run.

For PR #2 source evidence, read [bounded CLI progress](BOUNDED-CLI-PROGRESS.md).
The dated records below describe earlier installations and do not override this current record.

## Evidence and history

The records below preserve observations from 12 and 14 November. References to
unmerged work describe the state at that time. PR #1 is now merged into `main`;
merge does not mean installation or acceptance.

## 14 November 2026: pilot project enrolment and the path to a usable host

Read-only assessment on the primary host against installed release `0.1.0-6a00b329342a`
(source `cc71eeb`). `main` is four commits ahead (`e834132` to `81c7eb8`) and
remains uninstalled; installing it needs the operator's explicit approval. No Aegean
source, installation, host configuration or readiness state was changed, and
the test suite was not rerun.

### Observed

- `OWNER/PROJECT` is enrolled (`aegean enrol --check`), contrary to blocker 1
  below. It is the only enrolled real project.
- `aegean doctor --json` reports `fullWorkflowReady: false`. Two checks fail:
  `verifier-vm` (the Colima profile `aegean` is stopped; it passed on
  12 November) and `release-acceptance`.
- Specification drafting works on this host. Everything after specification
  approval is refused while readiness is false: see the readiness guard in
  `src/application/engine.ts` ("Full workflow acceptance is pending").
- Run `trial-01` (a Python CLI adapter) reached
  `spec-drafted`. Its Scout stage took 123 seconds and reported 17,191 output
  tokens; the reported input count of 2 is not credible, so input usage is
  unknown. Sample size is one run.
- That run held the single global lease while waiting for approval, blocking
  any other run on any repository or host. The operator had it cancelled and
  pilot project PR #1 closed on 14 November; `aegean status` now shows
  `owner: null`. The branch and the run's local worktree are retained.
- The pilot project's `aegean.json` still names the cancelled parser
  (`python3 -m unittest`, `python3 parse_linkedin_alert.py`) with the Node
  image. This release accepts only the toolchain's Node image. Whether that
  image contains `python3` was not tested.

### Verifier contract as implemented

Facts a project must design for (`src/domain/config.ts`,
`src/adapters/verifier.ts`): one fixed `verifier.command` for every protected
case; each case is stdin of at most 8,192 characters, an expected stdout of at
most 8,192 characters and an exit code; no per-case arguments; no network; a
read-only candidate mount; a 15-second limit per case. Output must therefore be
deterministic, and a project with several commands needs one entry point that
dispatches on its input. There is no route to revise an approved
specification; the run is cancelled and restarted.

### Proposed minimum for "stable" (awaiting the operator's explicit approval)

Of the seven requirement groups in [BOUNDED-CLI-SPEC](BOUNDED-CLI-SPEC.md),
three are needed before one pilot slice can run end to end on the primary host:

1. **R2, contained Builder execution.** The `detached-writer-contained` check
   cannot be waived, and the VM-backed fix is unproven.
2. **R1, acceptance for the executing host alone.** `src/adapters/acceptance.ts`
   requires distinct primary host and secondary host identities; the secondary host has no access route.
3. **R3, one authorised pilot with real receipt writers.** Acceptance requires
   evidence that only a run can create.

R4 to R7 are proposed for deferral: the pilot project is the only enrolled project,
comment approvals work, and cancel-and-restart is tolerable for small slices.

The operator asked on 14 November for any of the three to be fixed where the fix was
highly certain. None met that bar, and nothing was changed:

- R2 has no established fix. Its first step is the negative-control probe in
  step 1 of the specification's delivery sequence.
- R1 alone unblocks nothing. Acceptance also demands at least eleven receipts
  including a passing `detached-writer-contained`, so relaxing the host rule
  first would weaken a gate without making any run possible.
- R3 depends on both.

### Next actions

1. Obtain the operator's explicit approval of the three-item cut as the definition of
   "stable", or an alternative scope.
2. On a branch, prove or disprove the VM/tool boundary for R2 with bounded
   synthetic negative controls before building R1 or R3 on top of it. A failed
   control is a result to report, not to work around.
3. Ask the operator whether to install `main`. Regenerate evidence for the exact new
   artifact identity; old receipts do not transfer.
4. Repoint the pilot project's `aegean.json` once its first slice names an entry point.
5. Before the first build run, decide whether to persist role diagnostics; see
   the known limit under
   [run records and debugging](OPERATIONS.md#run-records-and-debugging). Until
   then, capture console output and write a [pilot note](PILOT-NOTES.md) for
   every real run.

## PR #1 remediation (merged; not installed at the last assessment)

The `bootstrap-v1` changes integrate the existing coordinator recovery work and
the [review remediation](PR-1-REVIEW.md). The operator selected explicit approval before
each candidate push; approval binds the commit, spec, suite and verification
receipt. Spec approval separately binds the published spec commit and digest.

The [later usability review](PR-1-FOLLOWUP-REVIEW.md) separately assesses global
leases, revisions, project compatibility, activation, approvers, pilot bootstrap
and host-specific acceptance. Its proposed policy changes are not implemented by
the original twelve-item remediation.

### Follow-up configuration fix and selected next milestone

The follow-up patch adds repeatable `configure --exclude PATH` and additive
migration of existing hosts. It preserves host identity, billing acknowledgement,
control/verifier locations and all existing exclusions. Short atomic locking
prevents concurrent writers losing exclusions; retained locks require inspection.
An additional regression fixes `/` so it excludes every descendant.

Final local verification: clean offline dependency installation, type checking,
**47/47 tests passed with no skips** (454.7 seconds), relative links in ten
README/docs Markdown files, and `git diff --check`. The new guards were first
observed failing. Independent review found no further actionable defect after
the root-exclusion correction. Hosted results for this new candidate require its
separately approved publication; the earlier green run below covers `a8f3e38`.

The next milestone is a bounded CLI pilot with independent host qualification.
[BOUNDED-CLI-SPEC](BOUNDED-CLI-SPEC.md) is the concrete draft for human review.
Its host/pilot acceptance, containment, local approval, revision, lease and routing
changes are **not implemented by this configuration patch**. example-project support is
a later milestone. No installation, host configuration, global instructions or
readiness state was changed on either Mac by this follow-up.

### Previous review remediation

- Candidate Git operations now share a fail-closed host-execution boundary:
  hooks, executable filters/diff helpers, candidate config includes, environment
  overrides and nested Git metadata cannot select host code for execution.
- Repairs receive public requirement identifiers and approved public text.
  Context is bounded, oversized reviews pause, policy is frozen per run, and
  verifier outcomes distinguish candidate failures, cancellation and unavailable
  infrastructure. The toolchain owns the supported verifier image.
- Recovery reconciles uncertain pushes and retained verifier resources, fences
  stale owners, serializes cancel/resume and retains ownership until cleanup is
  confirmed. Already-aborted commands never spawn; verifier preparation is
  cancellable. Same-process-group descendants are terminated before completion.
- Installation builds from a clean recorded commit. Release acceptance validates
  typed reports, host identities and all shipped artifacts, including the Node
  executable; see [the acceptance contract](ACCEPTANCE.md). Synthetic fixtures
  never write acceptance into the operator's real state.
- Host-specific exclusions move to required host configuration. The existing
  installation/configuration has not been migrated or modified by this work.

Previous combined verification on 12 November 2026:

| Check | Observed result |
| --- | --- |
| Dependencies | `npm ci --offline --ignore-scripts --no-audit --no-fund` passed |
| Types and scripts | `npm run check`; `node --check` for installer, source provenance and verifier setup passed |
| Automated tests | Mac full run at `e834132`: **45 passed, 0 failed, 0 skipped**, 440.5 seconds; subsequent fixture-only correction passed both verifier tests and type checking |
| Documentation | Relative links in all eight README/docs Markdown files and `git diff --check` passed |
| Independent review | Reported Git, approval, evidence, recovery and cancellation gaps fixed; focused checks passed; no further blocking implementation defect found |
| Native containment | **Failed** for detached/session-separated writers; release remains unaccepted |
| Hosted CI | `a8f3e38`: type checking and **45 passed, 0 failed/skipped** in run 43231027305 (archived CI record), after correcting the fixture's macOS-specific export path |

The first combined run exposed a fixture's ten-second Builder-start deadline.
Its setup allowance is now thirty seconds within the existing forty-second
fixture process budget, with early-exit diagnostics and cleanup. Production
timeouts and interruption/ownership assertions were not weakened. A subsequent
interrupted run took 58.5 minutes and failed three timing-sensitive fixtures;
it is not passing evidence. The final uninterrupted run used process-scoped idle
sleep prevention and passed all 45 tests. These deterministic fixtures are not
native or two-host acceptance. Publication requires the operator's candidate approval.

The Linux fixture correction changes only the test's in-memory shared-directory
setting and restores it afterwards; production configuration and verifier code
are unchanged. It retains all outcome/cleanup assertions and adds an assertion
that retained exports stay inside the fixture. The other 44 tests passed in the
same hosted run, so local revalidation targets this fixture; CI reruns the suite.

**New confirmed release blocker:** a bounded native probe using the installed
Codex sandbox profile and the revised process adapter returned parent exit 0,
then observed a detached/session-separated descendant write after parent exit.
This bypasses process-group cleanup. Ordinary use must remain gated until a
supported containment adapter passes `detached-writer-contained` on both hosts.
The exact unsatisfied check is required by acceptance validation. The npm entry
point is also outside the current Builder sandbox allowance; general npm/build
support is not claimed.

The alleged installed-source hash mismatch was disproved: clean `cc71eeb` and
the installed source both hash to `6a00b329342a459adb434c037fd4a6cb8ac67ea62d083b3166b3d16d2d952e08`
when symlink inputs use the installer's representation. The broader provenance
weakness is addressed by the new clean-build and artifact manifests.

## Original installed bootstrap

- Clean private repositories exist for `you1anna/aegean` and
  `OWNER/CONTROL_REPO`. The latter keeps protected suites and control
  metadata outside Builder access. Its ledger currently has no active owner.
- A versioned installation, managed command, Codex/Claude skill links and
  additive global guidance are installed on the primary host. Existing instructions are
  backed up. Repository-local OpenSpec integration is generated.
- Dependencies are locked; managed Node and release-local CLIs avoid changing
  the desktop app. The dedicated Colima verifier has explicit resource limits,
  a digest-pinned image and no candidate access to the host home or Docker socket.

## Historical bootstrap evidence (before remediation)

| Gate | Observed result | Remaining limit |
| --- | --- | --- |
| Type checking | `npm run check` passed | Hosted CI recorded separately in the PR |
| Automated checks | `npm test`: 20 passed, 0 failed/skipped | No claim of full coordinator fault-injection coverage |
| Dependency audit | Root and tools `npm audit`: 0 reported vulnerabilities | Point-in-time advisory check, not a security proof |
| Ownership | Concurrent local Git remotes reject a second owner and stale generation | Real two-host race and interrupted push recovery pending |
| Approval/integrity | Exact human receipt, stale hashes, immutable suite, bounded repairs and active time checked | Live human approval/merge path pending |
| Installation | Repeated primary host install selected the same release; rollback fixture preserves unrelated guidance | Secondary host installation pending |
| Native Builder sandbox | Managed Node probe rejects outside/symlink reads; live model uses restricted tools successfully | Later detached-writer probe failed; see the current release blocker above |
| Protected verifier | Manual isolation probes pass; independent Auditor's 12-case suite rejects broken fixture and accepts Builder repair unchanged | Real-project test strength and adapters remain unverified |
| Subscription authentication | Both live subscription smoke tests passed | Full lifecycle acceptance remains separate |
| Role loop and review | Live independent test generation, Builder repair and fresh candidate review pass | Scout/human approval/merge integration, coordinator audit and quota/interruption exercises pending |
| Post-merge archive | Documentation-only guard checked | Live merge/archival/recovery pending |
| secondary Mac | Bootstrap and runbook prepared | No access route established; installation unverified |
| Real pilot | Pending | Select one compatible bounded CLI change after synthetic acceptance |

The native probe must use `mise exec -- node scripts/probe-builder.mjs`, matching
the installed runtime. Running it with Homebrew Node failed because its external
dynamic library was correctly denied by the sandbox; the managed-runtime probe
passed without broadening access.

Private verifier evidence is committed as `evidence/synthetic-pilot.json` in
`OWNER/CONTROL_REPO`. It explicitly identifies the suite as manually authored.
The suite and expected values are not copied into this source repository.

The subsequent `evidence/live-pilot.json` records the separate subscription-backed
integration exercise: Claude generated 12 protected cases from the public
contract without implementation context; the negative control failed; Codex's
first repair passed the unchanged suite; a fresh Claude candidate review passed.
This used the installed adapters and a real Git-backed ownership lease, which
was released afterwards. Its receipt explicitly does not claim ordinary workflow
acceptance. No human approval or merge was fabricated. Raw transcripts and the
generated suite remain in private local acceptance evidence, outside Builder access.

Installed `aegean doctor --json` passed Node, all three CLIs, both subscription
logins, verifier VM and host configuration. It correctly reports
`fullWorkflowReady: false` because release acceptance is missing. Subscription smoke checks passed. Provider billing policy remains a host prerequisite. Both global
instruction files contain exactly one managed block;
both skill links resolve to the active release. Docker's selected context remains
`default`, and the synthetic pilot left no containers behind.

## Release blockers and next acceptance work

1. Resolve native detached-writer containment. Same-group process termination,
   model review and synthetic acceptance reports cannot satisfy this control.
   Keep ordinary runs disabled. Pilot project was enrolled on 14 November; see
   the addendum above. Enrol no further real project.
2. Review the combined bootstrap PR and explicitly approve any installation.
   Preserve host exclusions during configuration migration. Regenerate evidence
   for the exact new source/artifact identity; old receipts do not transfer.
3. Complete live Scout, commit-bound spec approval, publication approval and
   human merge/archive integration. Deterministic CLI recovery fixtures now cover
   races, uncertain pushes, interruptions, malformed results and quota responses;
   real two-host ownership and provider-failure exercises remain outstanding.
4. Run installation, isolation, lifecycle and recovery acceptance on the secondary host
   using its own authentication. No credentials are copied between Macs.
5. After synthetic/native acceptance and manual bootstrap review, authorize one
   compatible bounded real pilot and its human publication/merge/archive cycle.
   Full readiness requires that evidence as described in ACCEPTANCE.md.

The first adapter supports CLI stdin/stdout contracts whose dependencies are
already in the pinned image or candidate. UI, HTTP, native macOS and infrastructure
verification need additional reviewed adapters. This cannot yet replace delivery
checks for every existing system.

GitHub Free does not enforce private-repository branch protection. Human PR review
is an operating rule here, not a claimed server-enforced control. The coordinator
does not merge PRs. Nothing has been deployed or published publicly.

