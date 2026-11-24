# Accepted implementation plan

Approved by the operator on 12 November 2026 during specification review.

The later [bounded CLI pilot specification](BOUNDED-CLI-SPEC.md) records the
selected next-milestone direction and proposed replacement gates. It remains a
draft for human review; the baseline plan below describes the original bootstrap.

## Decisions

- Name: Aegean. Preserve the previous private repository and all local changes as
  legacy-project; create clean private source history. Publish only on request.
  On 24 November 2026, the maintainer requested publication. The private repository with the
  pull-request records becomes `you1anna/aegean-archive`. A new public
  `you1anna/aegean` receives the rewritten branch history.
- Targets: primary Mac and secondary Mac, independently operable. Repository bootstrap
  is the secondary host delivery route until a working connection is available.
- Significant work uses OpenSpec, isolated branches, protected acceptance tests,
  fresh independent reviews and human specification/merge approval. Small,
  low-risk, behaviour-preserving operations keep proportionate checks.
- Claude Scout and Auditor; Codex Builder. Subscription authentication only, no
  paid API fallback or purchased capacity. One Builder across hosts initially.
- Protected tests are mandatory for declaring the full workflow ready. Unsupported
  adapters remain limited; no silent downgrade to visible tests alone.
- Pilot with synthetic data, then one bounded real change; enrol other eligible
  personal development repositories when significant work begins. Sensitive,
  parked and production checkouts are excluded.

## Deliverables

1. Preserve legacy history, dirty/untracked/ignored files and verify recovery;
   update routing and remotes without carrying legacy history into new source.
2. Versioned TypeScript coordinator, exact dependency pins, repeatable installer,
   global agent skills/guidance and repository-local configuration/OpenSpec.
3. Pure state machine with immutable spec/suite/commit references; fresh role
   contexts; two repair attempts and a separately bounded infrastructure retry.
4. Private verifier repository and trusted execution. Builder cannot access
   protected test source, operator credentials, approval records or result keys.
   Candidate code runs separately from the oracle, with no privileged mounts.
5. Atomic cross-host ownership and durable checkpoints. No automatic stale-owner
   takeover. Reconcile interrupted effects before retrying; never duplicate PRs.
6. CLI start/status/resume/cancel/enrol/doctor/upgrade/rollback. Role usage,
   elapsed time, exact versions, evidence and limitations remain inspectable.
7. Test installation, isolation, negative controls, stale evidence, concurrent
   starts, crashes, cancellation, quota exhaustion and rollback on both Macs.

## Capacity, integrity and maintenance

One active Builder; 60 active automated minutes per approved run, excluding human
waiting. Two code repairs, one infrastructure retry. Token usage comes from CLI
events when available; unknown is not zero. No model calls for status or polling.
Pin the policy version per run. Keep commands structured, permissions explicit,
logs bounded and failures visible. Git-backed control metadata uses atomic
non-force updates; do not synchronise a live database between hosts.

Keep the coordinator small with one-way dependencies and tested module
boundaries. Upgrades use reviewed locks and versioned releases; previous versions
remain recoverable. Initial bootstrap is reviewed through a PR; it cannot claim
to have verified itself through a not-yet-installed system.

## Release gates

The full workflow is accepted only after passing the checks in STATUS.md on both
hosts. A ruleset on `main` requires a PR and the `deterministic` check. The administrator
bypass is limited to the documentation pushes that [AGENTS.md](../AGENTS.md) permits. Aegean
does not merge PRs. The operator remains responsible for the final merge.

## Sources checked during planning

- https://github.com/Fission-AI/OpenSpec/blob/main/docs/how-commands-work.md
- https://learn.chatgpt.com/docs/permissions
- https://code.claude.com/docs/en/headless
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
