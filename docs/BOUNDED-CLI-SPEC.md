# Independently accepted Macs and a bounded CLI pilot

Status: **draft specification for human review**. On 12 November 2026 the operator
selected a bounded CLI pilot first, with each Mac qualifying independently.
That direction changes the original both-host release gate. This document makes
the proposed implementation and its safety conditions concrete; it does not
authorize an installation, live pilot, global-instruction change or readiness
override. [The follow-up review](PR-1-FOLLOWUP-REVIEW.md) owns the findings.

## Outcome and scope

A supported Mac can qualify its own execution environment, run one explicitly
authorized bounded CLI pilot, collect real evidence and become accepted without
waiting for the other Mac. The ordinary path is request, specification decision,
automated build/verification/review, publication decision, human merge and archive.
The human reviews readable local artifacts; the CLI binds their full identities
without requiring transcription of four hashes.

The first adapter remains a bounded Node stdin/stdout CLI with dependencies
already in its reviewed image/candidate. example-project, Python/browser/database
adapters, online dependency installation, production access, automatic merging
and automatic cross-host takeover are excluded from this milestone. One active
Builder across hosts remains the initial capacity limit.

## Required behavior

### R1: Independent host and capability acceptance

- Replace the fixed primary host-plus-secondary host gate with explicit evidence for the executing
  host, release and supported capability. Another host's missing evidence cannot
  prevent a qualified host's single-host workflow, or make the other host ready.
- Bind the common source commit/policy and each host's actual shipped artifacts,
  runtime and image identities. Different platform artifacts must not be falsely
  represented by a single shared executable hash.
- Distinguish prerequisites, pilot authorization and ordinary acceptance. Status
  reports which is available and why. Cross-host handoff/operation is a separate
  capability requiring its own evidence; unsupported handoff remains refused.
- Reject old boolean gates, forged/stale/mismatched receipts and artifact drift.
  Migration is explicit; old evidence is historical rather than re-labelled.

### R2: Contained Builder execution

- Use an independently supervised container/VM boundary whose termination stops
  detached/session-separated writers before candidate capture or lease release.
  Process-group cleanup alone cannot satisfy this requirement.
- Prefer keeping subscription model authentication in the trusted coordinator
  and routing candidate execution through a narrow VM tool interface. Prove that
  the pinned CLI cannot fall back to host writing/execution tools. If this cannot
  be enforced, stop for design review; do not mount credentials into candidate
  reach or broaden host filesystem access as a shortcut.
- Candidate execution has no host home, credentials, protected suites, approval
  records or container-control socket. Host Git metadata is protected from
  writes. Candidate networking is denied; any future network capability needs a
  separate reviewed adapter and acceptance evidence.
- Use the pinned runtime image, an unprivileged user, dropped capabilities,
  bounded CPU/memory/PIDs/output/time and disposable writable scratch. Keep
  export size/type limits and the credentialed-host Git boundary already added.
- Record resources before starting them. On interruption or an uncertain daemon
  response, retain cleanup intent and ownership. Resume/cancel must reconcile
  actual termination before accepting another writer or freezing the candidate.

### R3: An explicit bounded pilot and real receipt writers

- A pilot authorization names one host, release, repository, run and request,
  with an expiry and explicit execution/repair budgets. It is an auditable human
  decision; no generic skip-acceptance switch or persistent readiness bypass.
- Containment, credential/oracle isolation, supported runtime/image and
  subscription prerequisites must pass **before** untrusted pilot execution.
  The currently failed detached-writer check cannot be waived by pilot mode.
- The pilot may generate the lifecycle/real-pilot evidence needed for ordinary
  acceptance without requiring that evidence before it runs. Publication and
  merge still require their own exact human decisions; pilot authorization
  cannot authorize a later candidate push.
- Evidence harnesses write the supported receipt/report schemas from observed
  checks, including failures and interrupted/unknown outcomes. They must not
  turn arbitrary operator-entered booleans or synthetic test fixtures into live
  acceptance. Receipt writers do not enable readiness themselves.
- Explicit acceptance validates the completed evidence and installed artifacts.
  A failed, expired or incomplete pilot remains unaccepted and recoverable.

### R4: Durable ownership without holding capacity during human waits

- Separate durable run state/ownership from temporary execution permits.
  Serialize repository effects and preserve one active Builder globally.
- Entering a human-wait state releases execution capacity only after all writers
  are confirmed stopped. Another repository can then make progress. Waiting is
  excluded from active-time accounting; no model polling or background scheduler.
- Resume acquires permits atomically, validates owner/generation, current base,
  spec, candidate, policy and evidence, then performs effects. Stale processes
  cannot publish or release a new owner's permit.
- Preserve short Git transactions, non-force updates and uncertain-push ancestry
  reconciliation. Do not replace fencing with longer lock timeouts. Migrate the
  ledger only at a reviewed quiescent boundary; incompatible clients fail closed.

### R5: Local human decisions and explicit approvers

- New project policy names its approver explicitly; support personal and
  organisation-owned repositories. Resolve/check the authenticated human account
  and bind its stable identity to approval, publication and accepted merge.
  Freeze this policy with the run; Builder cannot change it to gain approval.
- Local specification/publication commands display the exact request, artifact
  identities and readable changes, then require a deliberate operator decision.
  No unattended yes flag, piped confirmation or agent-authored approval. A TTY is
  an interaction prerequisite, not proof of human identity; document the trusted
  operator/coordinator boundary rather than claiming cryptographic human proof.
- `aegean publish --run ID` records authorization for the exact verified/reviewed
  candidate, rechecks ownership and remote identity, and pushes that same commit.
  A changed artifact or approver invalidates the authorization. A lost push
  response is reconciled without publishing a different head or asking the
  operator to authorize an already-confirmed identical effect again.
- Keep human merge separate. The CLI never posts a human approval on the user's
  behalf or merges the PR. Existing comment-based evidence requires an explicit
  compatibility path; installed skill instructions must match the new interface.

### R6: Revision with exact re-verification

- `aegean revise --run ID` provides a deliberate route from human review back to
  candidate preparation. It identifies the changed head/content and invalidates
  verification, review and publication evidence before further execution.
- Implementation-only revisions retain the immutable approved specification and
  suite. Contract changes require new specification approval and new independent
  tests. Revision budgets remain bounded; exhaustion needs a new human decision.
- Never accept a changed head merely because its history contains a verified
  commit. Verify/review the exact new candidate and obtain its publication
  approval. A descendant which reverses the verified behavior must be rejected.
- Remote edits, changed bases and already-merged PRs have explicit diagnostics
  and recovery routes; no blind overwrite, force push or fabricated verification.

### R7: Deliberate global routing activation

- Installation and routing activation are separate. Ordinary install/upgrade
  does not silently make an unaccepted workflow mandatory in global agent files.
- Activation is explicit and scoped to accepted host/project capabilities.
  Unsupported projects remain clearly unsupported and follow their separately
  approved project workflow; they are not described as Aegean-verified.
- Provide reversible removal/restoration of only Aegean's managed blocks, with
  backups and preservation of unrelated instructions. Existing installations
  receive an explicit migration action; this specification does not execute it.
- Rollback restores an internally consistent CLI, policy and activation state.
  Do not infer readiness from successful installation or silently alter billing.

## Verification and delivery sequence

1. Prove the VM/tool boundary with bounded synthetic negative controls: outside
   and symlink reads, credentials/oracle/socket access, network, nested Git,
   detached writers and cancellation. A failed control blocks pilot execution.
2. Implement schema/receipt and human-decision primitives with rejection tests;
   prove modified approver/spec/head/artifact and fabricated evidence fail.
3. Implement ownership/permit transitions with real local Git CAS races, blocked
   cleanup, interrupted/lost effects and old-client rejection. Demonstrate that
   human waits do not monopolize execution capacity and never permit overlapping
   Builders or stale publication.
4. Implement pilot, local decision and revision flows, retaining existing repair,
   active-time and candidate-capacity safeguards. Exercise a complete synthetic
   lifecycle and negative control, then a separately authorized real bounded
   pilot. Tests using fake services remain labelled orchestration tests.
5. Verify install/activation/rollback in temporary homes, run final type/script/
   dependency checks and the complete suite, obtain a fresh independent review
   and exact-candidate publication approval, and observe hosted CI. Human review
   and any installation/live-pilot authorization remain separate final actions.

Configuration exclusions are repaired independently in the follow-up patch:
repeatable additive configuration, identity preservation, a short atomic lock
and root-path exclusion coverage. That small fix does not implement R1–R7.
