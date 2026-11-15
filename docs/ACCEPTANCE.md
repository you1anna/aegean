# Release acceptance evidence

[Documentation](README.md) · [Status](STATUS.md) · [Operations](OPERATIONS.md)

Acceptance ties a release decision to the exact installed files and observed
test results. Missing, failed or stale evidence blocks readiness.

**The native Builder still fails the required detached-process containment check.**
Ordinary use requires a supported containment adapter and fresh native evidence.
Do not enrol further real projects. [Status](STATUS.md) records the failed probe
and existing enrolment.

The [acceptance validator](../src/adapters/acceptance.ts) owns the schema and
required check names. Never copy a synthetic fixture into operator state or mark
an unsupported capability as passed. Fixture providers imitate external systems
to test the coordinator. They are not release evidence.

## Identities

The version-2 installation manifest contains the source commit/tree and source
hash. Its `buildHash` covers compiled `dist`; `artifactHash` covers the canonical
manifest of all shipped files, file modes and symlink targets, including native
Claude, Codex/OpenSpec packages, dependencies, toolchain, scripts, policy and docs.
Only the two manifest files themselves are excluded from that traversal. Links
outside the release are rejected. `nodeHash` separately binds the external Node
executable used by the wrapper. Hashing uses bounded streams for large files.

The acceptance manifest has `schemaVersion: 2`, `sourceCommit`, `sourceHash`,
`buildHash`, `artifactHash`, `nodeHash`, distinct UUIDs in `hosts.air` and
`hosts.secondary host`, and 11–30 `receipts` containing `{path, hash}`. Paths refer to JSON
files directly under the private state directory's `acceptance-evidence/` folder.
The executing host must be one of those accepted host identities.

Each receipt has `schemaVersion: 1`, the same five release identities, `kind`,
`host`, `passed: true`, and `report: {path, hash}`. The report is typed JSON with
`schemaVersion: 1`, the same release/host/kind identities and a `checks` array of
unique `{name, passed: true}` entries. All required named checks must be present.
Plain text, empty reports, incomplete checklists, negative outcomes and stale
identities are rejected even when their file hashes match.

Each host needs `builder-isolation`, `protected-verifier`, `live-loop`,
`lifecycle` and `recovery` evidence. At least one host also needs `real-pilot`.
The native isolation checklist explicitly includes `detached-writer-contained`;
the current adapter has no passing evidence for it. The authoritative checklist
is `requiredEvidenceChecks`, not an operator-invented list of easier checks.

## Operator acceptance

Generate and review actual evidence with reviewed acceptance harnesses. Preserve
raw private reports and protected suites outside Builder access. Existing smoke
and live-pilot reports are historical; they do not automatically satisfy this
new schema or a different installed artifact identity. Normalized reports must
accurately describe the underlying tests, including unsupported/failed controls.

Only after all required controls work and their reports pass, assemble a reviewed
manifest and run:

```sh
aegean accept-release --manifest /absolute/private/reviewed-acceptance.json
aegean doctor --json
```

The acceptance command validates the evidence and installed artifacts before
writing `acceptance.json`. Doctor repeats those checks; boolean flags alone are
insufficient. These are operator-reviewed attestations with integrity checks,
not cryptographic proof that tests happened. The operator, compromised host and
intentional fabrication of evidence remain outside the threat model. Aegean
does not infer acceptance from an agent's success message.

Bootstrap exercises may proceed only through their recorded manual-review
exception. No exception turns fixture results into native, two-host or real-pilot
acceptance. The remediation chat did not install a new release or alter the
operator's acceptance state.
