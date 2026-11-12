# Status

Evidence recorded 12 November 2026. This is an installed bootstrap, not an
accepted release of the complete workflow. No real project has been enrolled.

## Completed

- Clean private repositories exist for `you1anna/aegean` and
  `OWNER/CONTROL_REPO`. The latter keeps protected suites and control
  metadata outside Builder access. Its ledger currently has no active owner.
- A versioned installation, managed command, Codex/Claude skill links and
  additive global guidance are installed on the primary host. Existing instructions are
  backed up. Repository-local OpenSpec integration is generated.
- Dependencies are locked; managed Node and release-local CLIs avoid changing
  the desktop app. The dedicated Colima verifier has explicit resource limits,
  a digest-pinned image and no candidate access to the host home or Docker socket.

## Acceptance evidence

| Gate | Observed result | Remaining limit |
| --- | --- | --- |
| Type checking | `npm run check` passed | Hosted CI recorded separately in the PR |
| Automated checks | `npm test`: 20 passed, 0 failed/skipped | No claim of full coordinator fault-injection coverage |
| Dependency audit | Root and tools `npm audit`: 0 reported vulnerabilities | Point-in-time advisory check, not a security proof |
| Ownership | Concurrent local Git remotes reject a second owner and stale generation | Real two-host race and interrupted push recovery pending |
| Approval/integrity | Exact human receipt, stale hashes, immutable suite, bounded repairs and active time checked | Live human approval/merge path pending |
| Installation | Repeated primary host install selected the same release; rollback fixture preserves unrelated guidance | Secondary host installation pending |
| Native Builder sandbox | Managed Node probe rejects outside/symlink reads; live model uses restricted tools successfully | Broader adversarial review pending |
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

1. Completed: operator confirmation and bounded subscription smoke tests with
   the configured production flags. Claude returned valid JSON; Codex used its
   restricted shell tool to write the expected synthetic file. Private receipts
   include the tested release hash, timings and provider-reported token usage.
2. Complete Scout, exact-hash human approval and merge/archive integration, plus
   independent coordinator review. The protected suite/Builder/candidate-review
   handoff passed under the bootstrap exception; this does not discharge the
   remaining lifecycle gates. Keep ordinary implementation gated and retain
   evidence for the exact installed source hash before acceptance.
3. Complete coordinator interruption, uncertain-push, malformed-response,
   cancellation and quota recovery exercises. Current state-machine tests alone
   do not establish end-to-end recovery. Inspect publication fencing before
   enabling cross-host recovery; automatic takeover is intentionally absent.
4. Run installation, isolation, ownership and recovery checks on the secondary host using
   its own authentication. No credentials are to be copied between Macs.
5. Review and merge the bootstrap PR manually, then run one compatible real pilot
   and its human merge/archive cycle. Enrol other eligible projects as touched.

The first adapter supports CLI stdin/stdout contracts whose dependencies are
already in the pinned image or candidate. UI, HTTP, native macOS and infrastructure
verification need additional reviewed adapters. This cannot yet replace delivery
checks for every existing system.

GitHub Free does not enforce private-repository branch protection. Human PR review
is an operating rule here, not a claimed server-enforced control. The coordinator
does not merge PRs. Nothing has been deployed or published publicly.

