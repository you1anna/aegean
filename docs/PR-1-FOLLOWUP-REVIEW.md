# PR #1 follow-up review: usable workflow

Assessed against `a8f3e38` on 12 November 2026. This addresses the later review
quoted in the remediation chat. [The earlier report](PR-1-REVIEW.md) addresses
the different twelve-item review originally supplied; it is not a disposition of
these new points. Neither report claims that this bootstrap is usable or accepted.

## Assessment

| Point | Finding and disposition |
| --- | --- |
| One lease for all repositories/hosts | Confirmed, including human waits. One active Builder was an explicit initial capacity decision, but one pending run need not monopolize execution capacity. Separate durable run ownership from repository/execution permits; release execution capacity during human waits and reacquire with generation/base/evidence checks. Per-repository leases alone must not silently permit concurrent Builders. |
| Edits before merge | Confirmed: there is no application/CLI revision route. The domain has a draft-reset transition, but this does not implement safe human revision. Add explicit revision and reverify the exact new head. **Reject ancestry-only acceptance:** an unverified descendant can undo every verified behavior while retaining the verified commit in history. |
| example-project compatibility | Confirmed unsupported. The adapter is a pinned Node CLI stdin/stdout adapter; example-project has Python dependencies, browser checks and existing `.claude/settings.json`. Writable scratch/build output, dependency preparation, synthetic data/services and reviewed agent configuration require explicit adapter support. Unrestricted network or removal of the configuration guard is not a safe fix. |
| Global agent instructions before readiness | Confirmed. Installation/activation manages both global files even when acceptance is false. The initial plan explicitly requested global routing, but this creates a practical block for unrelated significant work while Aegean is incomplete. Recommend making enforcement opt-in until a host/capability is accepted, preserving unrelated guidance and defining rollback. No global file is changed by this assessment. |
| Approval identity and organisations | Confirmed. Repository owner is the sole allowed commenter and merger; an organisation cannot be a `User`. Introduce a reviewed approver identity in frozen project policy, enforce it for approval/publication/merge, and invalidate evidence on policy changes. A local confirmation interface must produce an exact, auditable authorization receipt; merely having a TTY is not proof of human identity. |
| Acceptance cannot bootstrap itself | Confirmed for the supported CLI workflow. It requires lifecycle and real-pilot evidence before executing the steps that would generate them. Existing smoke scripts emit older/narrower receipts; the only new-schema writer is a synthetic test helper. Add a recorded, bounded pilot route and actual evidence-producing harnesses, with isolation prerequisites enforced before pilot execution. Never turn known failed containment into a passing receipt. |
| Both hosts required | Confirmed and inherited from the accepted plan. It conflicts with the useful interpretation of independently operable Macs. Recommend per-host/per-capability acceptance, with cross-host handoff a separate accepted capability. Host artifact identities must remain explicit; readiness on one host cannot attest another. This is a policy revision, not a silent test relaxation. |
| Detached Builder descendants | Confirmed release blocker, discovered during the earlier remediation; it was not introduced by that update. A VM-backed execution adapter is a plausible direction, not an established fix. Prove complete process teardown before releasing writers and freezing/exporting the candidate. Keep model credentials, protected suites and the container-control socket outside candidate reach. |
| Publication interaction | The friction is real. There are two approval comments (specification and publication), plus human merge; the publication command is 259 characters. The separate publication decision was explicitly requested by the operator. A local `publish` command can preserve that policy while hiding hash transcription, provided it binds the exact reviewed content, identity and receipt and refuses unattended approval. |
| Exclusion configuration | Confirmed regression: new configuration cannot supply the exclusions required by `doctor`, `enrol` and `start`. The follow-up patch adds repeatable `configure --exclude PATH`, requires reviewed exclusions for initial setup, and supports additive migration without changing host identity, billing acknowledgement, control remote or verifier checkout. Writes are serialized and ambiguous recovery is rejected rather than dropping exclusions. A further regression makes `/` correctly exclude every descendant. |

## Evidence and limits

- Hosted CI for a8f3e38 (archived CI record)
  passed type checking and all 45 tests, with no failures or skips. The local Node
  version is `v26.12.1`. These are deterministic tests, not native acceptance.
- Installed `aegean doctor --json` reports `fullWorkflowReady: false`. Node,
  pinned CLIs, subscription authentication and the dedicated verifier VM passed
  this read-only diagnostic; no model call or readiness mutation was performed.
- Pinned OpenSpec 2.0.0 `init --tools claude,codex --profile core --no-animation`
  was exercised in a temporary repository/home. It succeeded, generated ten
  files and **none** of the four Builder-blocking configuration files. Existing
  project configuration can still block Builder; the example-project checkout contains
  `.claude/settings.json`. No example-project records, credentials or live services were
  accessed, and that checkout was not enrolled or changed.
- The earlier native detached-writer and npm probes remain relevant. They were
  not rerun or promoted to passing evidence here. Mini, protected-repository
  contents and live lifecycle/pilot acceptance were not inspected in this review.

## Immediate exclusion fix

Use the existing atomic lock primitive with a separate configuration marker.
Inside the short filesystem transaction, load/validate current configuration,
union normalized requested paths with existing exclusions, and atomically write
the result. New setup requires remote, verifier path and at least one exclusion.
An existing host may add exclusions without repeating its remote/path; explicitly
conflicting identities are rejected. Do not remove exclusions through this API.

Verify through isolated CLI homes: missing/empty options cannot create partial
configuration, repeated paths normalize/deduplicate, updates preserve identity
and billing acknowledgement, concurrent writers cannot lose exclusions, and a
retained lock fails closed. No models/network/global host mutation are involved.
Configuration work is bounded by small option arrays and one local transaction;
it does not acquire or alter run leases. A retained lock has an explicit manual
inspection/recovery procedure. Reuse the lock and atomic writer rather than
introducing a second persistence implementation.

Implemented and verified locally: type checking and the full **47-test suite
passed with no failures or skips**. Both configuration regressions and the root
exclusion guard were observed failing before repair. Independent review found no
further actionable defect after the root fix. Actual host settings and installed
software remain unchanged. Exact-candidate publication still needs the operator's
approval, and hosted CI must validate that candidate separately.

## Selected next milestone

The operator selected a **bounded CLI pilot first, with each Mac qualifying
independently**. The detailed proposed implementation and acceptance checks now
live in [BOUNDED-CLI-SPEC](BOUNDED-CLI-SPEC.md). That specification awaits human
review; its features have not been implemented or accepted by this assessment.
example-project adapter support is a later milestone. One active Builder remains the
initial execution-capacity limit.
