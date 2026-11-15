# Bounded CLI checkpoint

## Model policy proposal — 15 November 2026

The operator requested task-based model selection and token budgets in the current PR.
The [proposal](../openspec/changes/task-model-selection-and-token-budgets/proposal.md)
defines requirements, design decisions and implementation checks. It is not implemented.
The existing pilot, decision and recovery work below remains required for release.

At assessment, PR #2 is open, is not a draft and has head `952ec75`.
The dated draft and pause statements below describe earlier checkpoints.
The new request authorises continued work; it does not authorise merge, installation or a real pilot.

Validation of this documentation change passed: locked dependency installation,
type checking, strict OpenSpec validation, local documentation links and `git diff --check`.
The full synthetic suite passed 141 tests, with no failures or skips, in 234.19 seconds.
Source behaviour is unchanged. These checks do not establish model qualification or release acceptance.

## Session close-out — 13 November 2026

Published the explicitly approved commit
`4ea484cf535fe3e3fcf203e22263f842b865608b` to
[draft PR #2](https://github.com/you1anna/aegean/pull/2). Confirmed the PR head
still matches that exact commit after CI completed.

Hosted CI run 43432930555 (archived CI record)
passed dependency installation, type checking and all 141 tests with zero failures
or skips. The test runner took 228.92 seconds. The preceding local full run with
inherited synthetic Git LFS configuration passed 141/141 in 257.78 seconds.
Fixture isolation preserves repository-local executable-filter rejection.

Next step: human review of PR #2 and completion of the bounded-CLI integration
and native acceptance items below. The PR remains a draft. Installation, live
pilot, merge and readiness changes require their existing approvals. This
close-out note is a local documentation commit awaiting publication approval.

## Historical checkpoint — 12 November 2026

**Implementation paused. Pilot not ready.**
PR #1 merged as `81c7eb8` (hosted CI passed on the merge commit, run 43302393459).
The implementation is preserved as an **unverified local WIP commit** on branch
`bounded-cli` (moved off the merged `bootstrap-v1`; not pushed). Do not discard it.
All implementation agents are interrupted. Do not resume implementation, tests,
VM startup or delegation without a new instruction from the operator.

## Authorization and baseline

The operator approved publishing `54d5029fb9524ec1795db501a01ca53428fa6415` and
implementing [BOUNDED-CLI-SPEC](BOUNDED-CLI-SPEC.md), R1–R7. That specification's
approved SHA-256 is `8634a846142b280034d08e3a87ad6453f91d15fa33d069ca8dbdc83b201c293c`.
Its push and PR update completed; hosted CI passed 47/47 tests in
run 43243755159 (archived CI record).
No later candidate was committed or published during this continuation.
Each subsequent candidate push needs its own approval. Installation, real pilot,
global routing activation and readiness overrides remain unauthorized.

## Implemented, with integration still incomplete

- R2: VM-contained Builder, restricted Codex tool bridge, bounded snapshots,
  recoverable Git import and resource cleanup intents. Old host-Builder entry
  points now fail closed. Native synthetic qualification passed 43 tool controls,
  21 VM controls and four protected-verifier controls; no live model calls.
- R1/R3: independent host/release evidence validation, signed observation records,
  native qualification and doctor prerequisite reporting. Pilot authorization
  and lifecycle evidence writers are still missing.
- R4: schema-2 durable run ownership, per-repository execution permits and one
  global Builder permit. Human waits release capacity after confirmed cleanup.
  Lost-grant fencing and typed control migration have interrupted drafts/tests.
- R5/R6: explicit stable approver identity, typed decision primitive, exact
  specification/publication artifact validation and domain revision transitions.
  Engine stops local specification review before pushing and checks exact
  publication/PR identities. Public approve/publish/revise commands are unfinished.
- R7: installation separated from scoped routing activation, with managed-block
  backups/recovery and temporary-home tests. No global instructions were changed.

## Verification actually observed

Type checking passed during integration, but the final interrupted working tree
has not received complete checks or independent review. The initial coordinator
smoke was blocked by local socket permissions; the next exceeded the old test
harness deadline. With socket access and an increased fixture deadline, a
synthetic diagnostic run reached `human-merge-review` with passing verification
and independent review, then waited for publication approval. It did not test
local typed decisions, publication/merge/archive or a real subscription pilot.
No full-suite pass is claimed for this working tree.

## Remaining work, in order

1. Finish scoped, expiring pilot authorization and enforce active/repair/revision
   budgets before execution. Wire actual lifecycle/recovery observations and
   receipt finalization; never manufacture missing evidence or enable readiness.
2. Complete CLI/application approve, publish, revise and control-migration paths;
   finish exact base/head/policy checks and contract-revision handling.
3. Complete interrupted ownership recovery tests; exercise local decisions,
   pilot rejection/expiry, revision, lost effects and full synthetic lifecycle.
4. Update operations/acceptance/skill documentation and architecture guards;
   run final relevant checks, full suite and fresh independent review.
5. Form a concrete candidate for separate publication approval and hosted CI.
   Installation and a real bounded pilot require separate authorization.

Capacity safeguards remain one global Builder, one execution permit per repo,
128 MB candidate volume, 100 MB/10,000 exported files, 512 MB and one CPU per
container, bounded outputs and execution budgets. Unknown cleanup retains intent
and ownership. Host model authentication stays outside candidate execution.
Global AGENTS text may remain visible to the trusted host client; qualification
proves tool restrictions, not that global instructions are hidden.

## VM shutdown and disk warning

At the operator's explicit request, the `aegean` Colima profile was stopped at about
17:02 UTC on 12 November. Normal shutdown waited at VZ shutdown; a targeted
force-stop was also issued. Final checks confirmed the profile **Stopped**, its
100%-CPU virtualization process exited, and no Aegean test processes remained.
Unrelated services were left untouched; the default profile was already stopped.

Colima reported: `Failed to unlock disk colima-aegean`. Rechecked at 22:45 UTC
with `LIMA_HOME=~/.colima/_lima limactl disk list`: `colima-aegean` shows no
`IN-USE-BY` owner, so the lock is clear and no unlock is needed. The VM remains stopped. No tests, VM restart or agents were run while saving
this checkpoint.
