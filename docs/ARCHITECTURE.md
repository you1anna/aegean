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

The global lease is the record of which host owns the run. Only one run can own
it, including while it waits for human approval. Local files do not create a
second shared ownership record.

Control updates use a parent revision and a normal Git push. Two competing pushes
cannot both advance the same parent. An uncertain push requires a fresh remote
read. Owner generations reject updates from an earlier owner.

No timeout permits another host to take over. Interrupted work requires an
explicit recovery decision. See [recovery](OPERATIONS.md#recovery).

## Approval and evidence

Specification approval binds the exact digest and published commit. The committed
specification must match the local files.

Candidate publication requires a separate human comment. It binds the candidate
commit, specification, suite and verification receipt. The coordinator reads both
approvals independently from GitHub. Candidate code stays local until publication
approval, so its CI cannot run before that decision.

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

The Builder uses a separate Codex process with a restricted filesystem profile.
Its tool network is disabled. It inherits neither user configuration nor the
operator's GitHub environment. Git metadata and agent configuration paths are
denied. Unreviewed executable agent settings block implementation.

**The native Builder boundary does not contain detached process sessions.**
A child process can survive its parent and continue to write within the sandbox.
Process-group cleanup alone does not satisfy the required isolation check.
Ordinary implementation remains blocked; see [release acceptance](ACCEPTANCE.md).

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
