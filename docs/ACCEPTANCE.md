# Release acceptance evidence

[Engineering](ENGINEERING.md) · [Status](STATUS.md) · [Operations](OPERATIONS.md)

Acceptance ties a release decision to exact installed files and observed test
results. Missing, failed or stale evidence blocks readiness. A source merge or
passing unit tests do not accept a release.

This page describes the bounded CLI contract in PR #2. Earlier bootstrap releases
use a different contract. Use the installed guide and `aegean doctor --json` for
that release; never transfer acceptance between versions.

## Identities

The [acceptance validator](../src/adapters/acceptance.ts) owns the release gate.
The [evidence adapter](../src/adapters/acceptance-evidence.ts) owns observation schemas,
required checks and their permitted sources.

The schema-3 gate names one host and the `bounded-cli-v1` capability. It binds:

- The source commit and source hash.
- The compiled build and shipped artifact hashes.
- The external Node executable hash.
- The policy identity and pinned runtime image.

Each host needs its own evidence for that exact release. Another host's result
cannot qualify it. Evidence references identify private receipts by path and hash.
The validator rejects duplicates, modified content and superseded observations.

## Prerequisites and full acceptance

Native prerequisites cover Builder isolation and protected verification.
`aegean qualify` records these observations; it does not accept the full release.
Native qualification requires its own approved exercise and runtime prerequisites.

Full acceptance also needs live role, lifecycle, recovery and real-pilot evidence
for the executing host. Required observations include detached-process containment,
exact approvals, human publication and merge, interruption and archive recovery.
The schema in code owns the complete checklist.

Reports and receipts use schema 2, signatures and explicit observation sources.
Each observation records a pass, failure or unknown result. Never turn a fixture
result into native or live evidence. Keep raw reports, signing material and
protected suites outside Builder access and outside this repository.

## Operator acceptance

Review actual observations from the required harness or coordinator. The coordinator records pilot, lifecycle and recovery observations from actual operations.
Missing exercises remain unknown; expired pilots cannot produce passing final receipts.
See [bounded CLI progress](BOUNDED-CLI-PROGRESS.md) for the latest checks.

Only after all required evidence exists and passes, submit a reviewed manifest:

```sh
aegean accept-release --manifest /absolute/private/reviewed-acceptance.json
aegean doctor --json
```

The command checks the installed artifacts and evidence before it writes
`acceptance.json`. Doctor repeats the checks. Boolean flags and agent success
messages are not evidence.

Signatures and hashes protect recorded evidence against undetected changes.
They do not protect against a compromised host or an operator who fabricates
observations. Approval to publish source does not authorise installation, a live
pilot or a readiness override.

## Model qualification

Model selection does not replace release acceptance. The shipped policy contains no qualified smaller model.
Each task class needs paired comparison evidence before activation. The comparison includes repairs and escalation.
The model policy validator rejects stale policy identities, unknown usage and failed quality thresholds.
See [model use](MODEL-USAGE.md) and the [qualification candidate](../openspec/changes/task-model-selection-and-token-budgets/qualification.md).

Monitored token allowances can overrun within an active CLI call. Strict token caps remain unsupported and reject execution.
Synthetic accounting tests establish rejection and recovery behaviour; they do not establish provider usage accuracy or savings.
