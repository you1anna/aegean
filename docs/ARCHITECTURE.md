# Architecture

[Documentation](README.md) · [Operations](OPERATIONS.md) · [Status](STATUS.md)

Aegean separates decisions, implementation and evidence. A small coordinator
controls the workflow; each model receives only the context and tools for its role.
This page describes the design and its limits. [Status](STATUS.md) records what
trials proved.

## Roles

| Role | Responsibility |
| --- | --- |
| Human | Approve the specification, approve candidate publication and decide whether to merge. |
| Scout — Claude Code | Draft a specification from the request and public project context. |
| Auditor — Claude Code | Create independent protected tests and review the candidate in a fresh context. |
| Builder — Codex | Write and repair candidate code within the approved scope. |
| Verifier | Execute the candidate in an isolated container and compare results with protected expectations. |
| Coordinator | Control state, credentials, ownership, budgets and external actions. |

The normal sequence is specification, human approval, protected tests,
implementation, verification, review, publication approval and human merge.
The coordinator never posts an approval for the human or merges a pull request.

## Code structure

```text
CLI → application services → domain rules
                          → adapters
```

- `src/cli.ts` receives commands.
- `src/application/` coordinates each operation.
- `src/domain/` owns pure workflow rules and data contracts.
- `src/adapters/` handles processes, files, Git, GitHub, agents and verification.

Domain code does not import application services or adapters. Tests guard this
boundary. There is no general scheduler or background model polling.

## Data ownership

| Data | Owner |
| --- | --- |
| Approved change contract | OpenSpec files in the project. |
| Protected test source and expected results | The private verifier repository. |
| Shared run state and global ownership | The verifier repository's separate `control` branch. |
| Private execution context and local paths | Local run records. |
| Reusable implementation | This source repository. |

The control ledger records durable run ownership separately from execution capacity.
Each repository has one execution permit. One global Builder permit limits
implementation across hosts. Human waits release permits only after confirmed cleanup;
the run retains its owner. Local files do not create a competing shared owner.

Control updates use a parent revision and a normal Git push. Two competing pushes
cannot both advance the same parent. An uncertain push requires a fresh remote
read. Owner generations reject updates from an earlier owner.

No timeout permits another host to take over. Interrupted work requires an
explicit recovery decision. See [recovery](OPERATIONS.md#recovery).

## Approval and evidence

Approval binds the specification revision, candidate and verification evidence.
The source in PR #2 separates local decisions from publication. It stops for
local specification review before the first push. Public local-decision commands
remain incomplete at this checkpoint; see [bounded CLI progress](BOUNDED-CLI-PROGRESS.md).

The [operations guide](OPERATIONS.md#run-lifecycle) describes the earlier bootstrap
comment-approval workflow. Use the installed release's guide for live operations.

Protected tests expose public requirement identifiers to repair feedback. The
Builder receives the approved requirement text, not hidden cases, expected
results, raw output or arbitrary Auditor prose.

Response schemas check structure, not correctness. Deterministic tests, negative
controls and independent review serve separate purposes. An agent's success
message is not verification evidence.

## Execution boundaries

### Model calls and candidate code

Claude planning and review calls have no tools. They use subscription login,
restricted mode and bounded inputs. Their responses must pass schema checks.

The Builder uses a trusted host Codex client and a restricted tool bridge.
Candidate execution occurs in a dedicated VM container. Bounded snapshots supply
candidate files; validated import returns the result to the worktree. Host model
authentication stays outside candidate execution.

The old host-execution entry points refuse use. Resource and import records
support interruption recovery. Unknown cleanup retains ownership and execution intent.
Native synthetic controls are recorded in [bounded CLI progress](BOUNDED-CLI-PROGRESS.md);
they do not establish full live workflow acceptance.

The installed bootstrap used a native process boundary that failed detached-process
containment. Its evidence does not describe the newer VM boundary or qualify a
new release. See [release acceptance](ACCEPTANCE.md).

### Git on the host

The coordinator controls host Git operations. It suppresses hooks and auxiliary
execution. It rejects executable filters, diff helpers and writable configuration
includes. Environment overrides cannot change the configuration between validation
and execution. Candidate scripts are not trusted host helpers.

### Protected verification

The verifier exports an exact candidate commit. It rejects symlinks and paths
that can contain secrets. Candidate processes run in a dedicated Colima Docker
context, with these restrictions:

- No network, host credentials, protected test mounts or Docker socket.
- A read-only filesystem, an unprivileged user and no extra capabilities.
- Explicit CPU, memory, process and time limits.

The host compares results with protected expectations; it never imports candidate
code. The candidate sees its runtime inputs. Public checks use the same restricted
container boundary.

The coordinator records container and export intentions before execution. If
cleanup remains uncertain, resume and ownership release stay blocked. Cancellation
and crash recovery must reconcile those resources too.

## Scope and limits

The first adapter supports CLI input/output contracts. Dependencies must exist in
the pinned image or tracked candidate. Network installs, native macOS tests,
browser tests, HTTP services and privileged infrastructure need reviewed adapters.
Do not enrol a project whose required verification exceeds this boundary.

[toolchain.json](../toolchain.json) owns execution budgets and supported versions.
[Operations](OPERATIONS.md) explains installation and the current runtime limits.
[Acceptance](ACCEPTANCE.md) explains evidence for an exact installed release.

These controls address agent mistakes and hostile candidate code within the tested
boundary. They do not protect against the workstation administrator or a
compromised OS, hypervisor or provider. An operator can also override controls
outside Aegean. GitHub Free does not enforce private repository branch protection.

Test strength and defects after merge need measurement before any claim of
productivity gains.
