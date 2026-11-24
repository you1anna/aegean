# PR #1 review assessment and remediation

Reviewed 12 November 2026 against PR head
`cc71eeb98766fdeb25ca75ecdce3d8c7f70790b8` and a separate snapshot of the existing
uncommitted recovery work. The assessment sections below describe that pre-fix
state. The operator subsequently authorized integrating the recovery work and selected
human approval before each candidate push. Implementation and final verification
are recorded in [STATUS](STATUS.md); no release acceptance is claimed.

[PR #1](../docs/history/pull-requests/1.md) remains open and draft. Its two
hosted deterministic jobs passed. The pasted review has not been posted on GitHub;
the PR had no submitted reviews or conversation comments when inspected.

## Decision

Keep ordinary runs and real-project enrolment gated. Most findings are valid,
but several suggested remedies need correction. In particular, hook suppression
alone does not prevent candidate-controlled Git helpers from running on the
host, and blocking workflow-file edits alone does not isolate CI execution.

The specific installed-hash mismatch in finding 11 is **not reproducible**:
applying the installer's actual algorithm, including its symlink representation,
to clean `cc71eeb` produces the exact installed source hash.

## Findings and dispositions

| Item | Assessment | Proposed disposition |
| --- | --- | --- |
| 1. Host pre-push hook execution | Confirmed at the PR head with a synthetic local remote. The uncommitted `pushExact` already suppresses this hook; it is not yet in the PR. | Retain that fix and add regression coverage. Extend protection to Git filters and diff helpers, described below. Do not add `--no-verify` indiscriminately: it is not accepted by every Git subcommand and does not suppress all hooks. |
| 2. CI before human review | Valid trust-boundary issue. Same-repository publication can execute candidate code with workflow privileges. Not all secrets are automatically injected into every job, but editable workflows can request available secrets; existing workflows may already expose credentials to changed code. | Require an explicit publication decision for the exact candidate before a push that can trigger privileged CI, or use a separately reviewed isolation arrangement. A workflow-path ban or a promise of no custom secrets alone is insufficient. |
| 3. Approval of unpublished spec revisions | Confirmed by application fixture. Editing the draft updates the ledger hash while the remote commit and PR body remain unchanged. | Commit each spec-only revision, push and reconcile its exact commit, refresh the PR body, then accept an approval bound to that published revision. Invalidate older approvals. |
| 4. Missing protected-test repair feedback | Confirmed by code inspection. Repairs receive reviewer findings only; a test failure plus an empty passing review yields no test guidance. | Send bounded public requirement identifiers/messages plus review findings. Do not directly forward arbitrary Auditor-authored `feedback`: a prompt is not a confidentiality filter. |
| 5. Oversized context and review diff | Confirmed: a tracked 70,000-byte JS file aborts before Scout and retains the global lease. The 200,000-byte review-diff subprocess limit also throws rather than recording a recoverable state. | Bound Scout input with explicit omission/truncation metadata. Oversized reviews must pause/escalate with actionable diagnostics; never silently truncate a security review and accept it as complete. |
| 6. Policy not pinned on resume | Confirmed. A run with a different recorded policy is still accepted by the transition function; execution reads current installed limits. | Bind runs to a complete policy identity/snapshot and reject incompatible resume before any external execution. Keep status/cancel available; document migration or rollback. |
| 7. Candidate defects treated as infrastructure | Mostly valid. Export rejection, time/output limits and operator interruption are conflated with infrastructure faults. However, Docker documents `docker run` exit 125 as a Docker-level error; blindly treating every 125 as a candidate failure would also be wrong. | Add explicit failure reasons and distinguish rejected candidate, candidate resource limit, operator cancellation and infrastructure failure. Use container lifecycle evidence when an exit code is ambiguous. |
| 8. Verifier image ownership | Configuration drift is real: setup pulls the toolchain image, host `image` is unused, and verification uses the project image. An alternate image can work if already present; lack of an automatic pull is not inherently a defect. | For the initial adapter, make `toolchain.json` the supported-image authority, require project compatibility before acquiring a lease, and remove/migrate the unused host setting. Additional images require explicit reviewed preparation and acceptance, not a pull inside verification. |
| 9. Cancel/resume race | Valid at the PR head. Existing recovery work now uses one atomic execution lock for both operations. | Preserve and complete that work in this bootstrap PR, including process-tree termination and deterministic races. Do not call it complete based solely on the edited implementation. |
| 10. Acceptance flags | Code checks three booleans and source-hash equality. The requirement to retain actual evidence is currently an operator rule, not machine verification; a workstation administrator is already outside the threat model. | State that distinction explicitly. Add an evidence manifest with validated receipt identities/content hashes and explicit lifecycle/host scope. Hashes establish integrity, not proof that an operator actually performed a test. |
| 11. Installed source provenance | Reject the alleged mismatch for this installed version; exact calculation below matches. Accept the broader weaknesses: dirty/untracked inputs are allowed, the commit is not recorded, and ignored build output is copied but not included in the source fingerprint. | Record commit/tree, reject dirty release inputs, build in clean staging and hash a defined installed-artifact manifest. Source identity and installed artifact identity are distinct facts. |
| 12. Coverage | Valid at `cc71eeb` for full engine/archive/verify orchestration. There are already helper tests for candidate export, container arguments and archive path restrictions. Existing recovery work adds engine/archive orchestration tests with fake external services. | Complete that coverage and add direct verifier outcome/cleanup tests. Preserve the distinction between deterministic orchestration tests and live native/container/provider acceptance. |

## Additional blockers established during this assessment

### Candidate-controlled Git filters and diff converters run on the host

`saveCandidate()` uses `git -c core.hooksPath=/dev/null add -A`. A repository
with `filter.review.clean = sh ./filter.sh` and a matching `.gitattributes`
entry runs the candidate's edited `filter.sh` during staging. This happens
**before protected verification**. Disabling hooks does not disable filters.

The review command also runs ordinary `git diff`. With
`diff.review.textconv = sh ./diff.sh`, an edited repository script executes
during diff generation. The repro only wrote marker files in its synthetic
temporary parent directory; it did not access credentials or other projects.

Both routes were reproduced. Adding `--no-ext-diff --no-textconv` prevented the
diff helper from running in the same fixture. Filter handling needs its own
boundary: use reviewed inert Git configuration/object operations, or reject
unsupported execution-capable repository configuration before candidate work.
Inspect effective config/includes, filesystem-monitor helpers and environment
overrides as part of that boundary. Do not assume denying the Builder `.git`
also prevents these executions by the credentialed coordinator.

These mechanisms are documented in [Git attributes](https://git-scm.com/docs/gitattributes)
and [Git hooks](https://git-scm.com/docs/githooks). A regression should make
hooks, filters and diff helpers separately attempt a synthetic outside-worktree
write and assert none is executed by coordinator operations.

### Cancellation can leave descendants alive

The existing uncommitted regression
`test/process-recovery.test.ts` fails: **descendant survived command completion**.
`src/adapters/process.ts` schedules SIGKILL after SIGTERM but clears that timer
when the immediate child closes. A descendant that ignores SIGTERM and closes
its inherited output streams can remain alive after the coordinator returns.

The test cleans up its synthetic child afterwards. The product consequence is
that releasing an execution lock is not yet evidence that all candidate writers
have stopped. Complete process-group termination before allowing a new execution
or reporting successful cancellation. Do not weaken the assertion.

### npm is unavailable in the installed Builder sandbox

A native probe using managed Node and the installed Builder permission profile
could execute Node, but reading the actual npm JavaScript entry point returned
`EPERM`; invoking it failed. The mise `bin/npm` wrapper itself is readable,
but its `lib/node_modules/npm` implementation is outside the allowed Node `bin`
directory. A wrapper-only probe would miss this distinction.

This confirms the reviewer's concern on this host. The first pilot must either
be a compatible dependency-free CLI or include a separately reviewed runtime
and build adapter. Read-only public-check mounts also prevent ordinary in-place
build output. Do not broaden home-directory access to make npm work. The
earlier live pilot does not establish general npm/build support; its private
suite was not inspected in this assessment.

## Corrections to the smaller comments

- `.aegean-tmp` is created but not assigned as `TMPDIR`. Files placed there can
  be staged by `add -A`; the empty directory itself is not committed. Prefer
  dedicated writable scratch with an explicit exclusion enforced by the
  coordinator, not only a Builder-editable ignore rule.
- Personal exclusion names belong in reviewed host policy. Preserve the current
  realpath and production/sensitive-path restrictions during migration; removing
  names from source must not silently remove the protection.
- Duplicate CI is confirmed: the bootstrap branch matches `push` and has an open
  `pull_request`. Restrict the push trigger to `main` while retaining PR checks.
  That reduces duplicate runs; it is not the fix for candidate CI privileges.
- Runtime/release-version literals are duplicated. Package version, policy
  version and configuration-schema version are different concepts and should
  remain separately owned. Package-lock repetition is generated, not a second
  manually maintained authority.
- A shallow control-branch clone is a reasonable capacity improvement, but
  the uncommitted uncertain-push reconciliation uses commit ancestry. A depth-one
  change must retain bounded deepening/fetch logic and prove acceptance when a
  later legitimate control commit has already advanced the remote.
- `setup-verifier` installs current Homebrew packages before verifying pins when
  tools are absent. Preflight should fail without mutation or use an explicitly
  pinned supported installation route. Do not describe current setup as a fully
  reproducible dependency installer.
- Reviewer prompt injection is a real residual risk. Review output stays
  untrusted advisory input; deterministic evidence and human review remain
  separate requirements. The new host-execution findings show why a model review
  cannot authorize execution of candidate-controlled helpers.

## Proposed specification for the remediation

This is significant security/integrity work. Treat it as an explicit continuation
of the initial bootstrap review route, not an ordinary run or an implicit lifting
of acceptance gates. Preserve existing recovery changes; coordinate ownership
before editing overlapping files. No installation, merge, enrolment, publication
of the repository, or readiness override is included.

1. **Constrain host execution.** One Git adapter owns candidate-facing command
   policy. Keep credentialed transport separate from interpretation of candidate
   files; suppress hooks and diff helpers, and fail closed on unsupported filters
   or other execution-capable settings. Cover staging, review, worktree creation,
   push and archive paths. Fix descendant cleanup before releasing local locks.
2. **Bind human decisions to visible Git identities.** Permit human edits to the
   draft before approval, then commit/push each spec-only revision and update the
   PR using a durable, retryable effect. Store its commit and spec-tree digest.
   Reject approval if local content, remote head or displayed revision differs.
   After approval, a spec change requires a new approval/suite; no silent reuse.
3. **Add a publication boundary.** Recommended initial policy: present the exact
   verified candidate locally and require the human's deliberate authorization
   before its first CI-triggering push. Bind that authorization to commit,
   spec, suite and verification receipt; changing any invalidates it. Final human
   merge remains separate. A future unattended publication mode needs a reviewed
   CI isolation model covering tokens, secrets, OIDC, runners and deployment
   integrations, not just `.github/workflows` paths.
4. **Make repairs bounded and informative.** Public requirement IDs are the only
   protected-suite feedback exposed to Builder; resolve text from the approved
   public contract. Bound context bytes and total input. Record an explicit
   incomplete-review outcome for oversized diffs. Distinguish candidate failures,
   resource limits, cancellation and infrastructure failures, while preserving
   two repairs, one infrastructure retry and the existing active-time budget.
5. **Freeze runtime and release identities.** Persist policy identity; validate
   supported verifier image before leasing or calling a model. Build releases
   from clean committed inputs in clean staging, record source commit/tree plus
   shipped artifact digests, and validate typed acceptance receipts for that
   exact release. Preserve rollback and unrelated host configuration.
6. **Finish evidence and documentation.** Fold the completed recovery work into
   PR #1, add the new rejection controls, remove duplicate CI, and update STATUS
   with observed results and explicit remaining live/two-host/pilot limits.

### Measurable checks and preservation requirements

| Concern | Required evidence |
| --- | --- |
| Capacity/scalability | 70 KB source does not crash Scout preparation; >200 KB review diff cannot produce a passing complete review; byte/output/time limits remain enforced. Control history currently remains a full clone; bounded shallow/deepen work is explicitly deferred to preserve reconciliation correctness. |
| Concurrency | Deterministic cancel/resume and recovery races allow one executor; the ignoring-SIGTERM descendant is dead before successful completion; no lock-timeout extension or automatic foreign-host takeover. |
| Data integrity | Uncommitted/revised/remote-divergent specs cannot reuse approval; unauthorized or stale candidate publication produces zero candidate pushes; changed policy, suite and evidence reject before effects. Unknown push acknowledgement is reconciled without replay. |
| Code quality/reuse | Git execution policy, policy identity, image support and feedback mapping each have one owner; entry points call application logic and adapters; existing import-boundary checks still pass. No directory restructure is necessary. |
| Verification | Test-first regressions for every retained behavior change, including malicious Git helpers, verifier outcome classification, cleanup and publication refusal. Run clean dependency install, type check and all tests on the final combined state; then hosted CI. |
| Observability | Record typed failure reasons, omission counts and immutable candidate/approval/receipt identities. Keep raw protected input/output private and distinguish unknown provider outcomes from failures. |
| Recovery | Preserve the current non-force Git lease and exact-push reconciliation. Spec PR updates and publication authorization are idempotent. Keep status/cancel usable for incompatible releases; upgrades/rollback cannot silently migrate active policy. |

Native isolation and real Colima behavior require separate acceptance after
implementation. Fake external responses prove orchestration only. secondary Mac and
real two-host/pilot acceptance remain outstanding; this report provides no
substitute for those gates.

## Decisions recorded and remaining attention

- the operator selected **human authorization before each candidate push** and confirmed
  the existing recovery work was not being edited elsewhere and should be
  integrated. The remediation continues the same bootstrap PR; no deployment,
  installation or acceptance override is included.
- The independent follow-up review found and the native probe confirmed a detached
  process can continue writing inside its old worktree after the parent exits.
  This remains a release blocker requiring a supported containment adapter.
  [ACCEPTANCE](ACCEPTANCE.md) explicitly requires the unsatisfied native check.
- Follow-up review also identified `GIT_CONFIG` bypass, nested-repository helper
  execution (including case-varied metadata), incomplete artifact/evidence
  validation, an initializing-lock race,
  retained verifier cleanup and late cancellation gaps. These were fixed with
  regression coverage. The final read-only review found no further blocking
  implementation defect; detached-session containment remains unresolved.
- npm/build compatibility, secondary host acceptance and the real pilot remain unverified.
  The control ledger deliberately retains full history for uncertain-push ancestry
  reconciliation; a shallow clone optimization is deferred until its bounded
  deepening/reconciliation behavior has dedicated tests.

Other reviewer questions have proposed defaults here: edit/commit/push spec
revisions before approval; expose public requirement feedback only; keep the
first pilot within supported CLI capability; finish recovery in this PR; own the
initial verifier digest in the toolchain; validate evidence content/identity rather
than three booleans. No GitHub comments need to be posted to carry out local fixes.

The ordinary Aegean path remains unavailable. Work here uses the recorded initial
bootstrap exception, with the user's explicit integration instruction. It does
not authorize other projects to bypass the workflow or treat visible tests as
protected native verification.

## Verification performed

- Clean `cc71eeb` snapshot: `npm ci --offline --ignore-scripts --no-audit --no-fund`,
  `npm run check` and `npm test` passed: **20/20**.
- Snapshot of the pre-existing recovery edits: same dependency/type checks passed;
  tests were **28 passed, 1 failed**. Failure is the descendant-termination test
  above. Source files in the working checkout were not modified by these runs.
- Synthetic real-Git probes: original push executes the pre-push hook; current
  `pushExact` suppresses it; hook-suppressed staging still executes the configured
  clean filter; ordinary review diff executes textconv; explicit diff suppression
  blocks it. `git diff --no-verify` is invalid, confirming it is not a universal fix.
- Synthetic application probes: draft revision changes approval hash without
  commit/push/PR-body update; 70 KB source aborts before Scout with lease retained;
  transition accepts a run whose policy string differs from the installed one.
- Native installed-profile probe: managed Node runs, actual npm entry point read
  is denied (`EPERM`), npm invocation fails. No model call or package install.
- `aegean doctor --json` outside the additional shell sandbox: only release
  acceptance fails. An initial sandboxed doctor also denied Claude/VM access;
  those were environmental restrictions, not established host failures.
- `aegean enrol --check`: fails because this checkout has no `aegean.json`.
  Nothing was enrolled or installed, and no acceptance state was modified.

### Reproducible source identity

Hash input follows `scripts/install.mjs`: sorted names, a NUL separator, then
file bytes; a Git symlink contributes `symlink:` followed by the link target,
not the dereferenced target contents. Reading those inputs directly from the
commit produced:

```text
commit:       cc71eeb98766fdeb25ca75ecdce3d8c7f70790b8
computed:     6a00b329342a459adb434c037fd4a6cb8ac67ea62d083b3166b3d16d2d952e08
installation: 6a00b329342a459adb434c037fd4a6cb8ac67ea62d083b3166b3d16d2d952e08
```

This disproves the specific alleged source-fingerprint mismatch. It does not
attest every installed executable: copied `dist` output and the native Claude
binary are outside this source fingerprint, and clean build/artifact manifests
are still needed for that stronger claim.

## External references

- [Git hook configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath)
  explains per-command hook suppression.
- [Git attributes](https://git-scm.com/docs/gitattributes) documents filters and
  diff text conversion; the local marker tests establish their applicability here.
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
  and [secret availability](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
  establish the CI trust distinction. No live exploit or repository-secret
  inspection was performed; the exposure assessment is an inference from these
  platform semantics and Aegean's same-repository push behavior.
- [Docker exit status](https://docs.docker.com/engine/containers/run/#exit-status)
  is why a blanket reclassification of exit 125 is not a sufficient remedy.
