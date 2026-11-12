# Coordinator recovery acceptance

Scope: bootstrap coordinator checks on the primary Mac, requested 12 November
2026. Ordinary implementation remains gated. No real approval, merge or provider
outage is simulated against live services.

## Plan and design constraints

- Exercise the real CLI/application code in temporary homes and local Git
  repositories. Substitute only external provider/GitHub/container responses;
  keep actual Git, checkpoints, transitions and process termination. Never write
  acceptance overrides into the operator's real state directory.
- Prove failure before repair for malformed responses, uncertain pushes,
  interrupted effects, stale publication and incomplete archive recovery.
  Preserve bounded repair/active-time policies and the one-owner Git lease.
- Keep one responsibility per module. Add a durable effect journal only where
  repeated external work is demonstrated; keep workflow rules pure. No framework
  or directory restructure is needed.
- Capacity: serialize integration fixtures and cap child output/runtime. At most
  one Builder per fixture and one shared owner; status/recovery uses no model.
- Concurrency/integrity: use the same atomic local lock for resume and cancel;
  reconcile acknowledged remote commits before retry; freeze project/spec/suite/
  candidate identities before publication. Never extend a lock timeout as a fix.
- Verification: complete local lifecycle with synthetic approval/merge fixtures;
  explicit rejection controls; interruption, quota, lost-response and replay
  tests; full final type check/tests and hosted CI. Real two-host, human GitHub
  approval and provider-quota exhaustion remain separately identified limits.
- Observability/recovery: keep private raw results and stable event receipts,
  preserve unknown outcomes, expose a deliberate operator recovery route, and
  verify that cleanup releases only owned locks/processes. SIGKILL/power loss
  must retain a marker and require inspection, not automatic takeover.

The measurements and final remaining gaps are recorded in STATUS.md. The fixture
providers prove orchestration behaviour, not provider correctness or sandbox
isolation; those have separate native/live probes.
