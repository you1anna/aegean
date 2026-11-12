# Status

Evidence recorded 12 November 2026. This is an installed bootstrap, not an
accepted release of the complete workflow. No real project has been enrolled.

## PR #1 remediation (not installed)

The `bootstrap-v1` changes integrate the existing coordinator recovery work and
the [review remediation](PR-1-REVIEW.md). The operator selected explicit approval before
each candidate push; approval binds the commit, spec, suite and verification
receipt. Spec approval separately binds the published spec commit and digest.

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

Final combined verification on 12 November 2026:

| Check | Observed result |
| --- | --- |
| Dependencies | `npm ci --offline --ignore-scripts --no-audit --no-fund` passed |
| Types and scripts | `npm run check`; `node --check` for installer, source provenance and verifier setup passed |
| Automated tests | Mac full run at `e834132`: **45 passed, 0 failed, 0 skipped**, 440.5 seconds; subsequent fixture-only correction passed both verifier tests and type checking |
| Documentation | Relative links in all eight README/docs Markdown files and `git diff --check` passed |
| Independent review | Reported Git, approval, evidence, recovery and cancellation gaps fixed; focused checks passed; no further blocking implementation defect found |
| Native containment | **Failed** for detached/session-separated writers; release remains unaccepted |
| Hosted CI | `e834132`: **44 passed, 1 failed** because the direct verifier fixture tried to create macOS `/private` on Linux. Follow-up uses a disposable export root and requires a fresh hosted run; see PR #1 for its result |

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
   Keep ordinary runs and real-project enrolment disabled.
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

