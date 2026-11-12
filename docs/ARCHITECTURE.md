# Architecture and trust model

The CLI calls application services. Application services call pure workflow rules
and process/GitHub/Git/filesystem/agent/verifier adapters. Dependencies do not point
back from domain code into application or adapters. Tests guard this boundary.

## Ownership

OpenSpec in each project owns the contract. The private verifier repository owns
acceptance source. Its separate `control` branch owns run state and the global
lease. Local run files contain private execution context and paths, never a
competing shared lease. The public-ready source repository owns reusable code.

Control commits use a parent revision and normal non-force push. Competing pushes
cannot both advance the same parent. Unknown push outcomes require rereading the
remote. No expiry grants another host permission to take over. Owner generations
fence later coordinator updates. This is intentionally one active run initially;
human approval waits also retain its lease. No distributed scheduler is required.

## Trust boundaries

Claude planning/review calls have no tools, use subscription login, safe/restricted
mode and explicit bounded inputs. Responses pass structural validation. Builder
uses a separate Codex invocation, filesystem-deny profile, disabled tool network,
no inherited user config and no operator GitHub environment. Its .git and agent
configuration paths are denied. Unreviewed executable repository agent settings
block implementation. Profile enforcement must be tested on each host/release.

The coordinator, not any model, owns credentials, worktree commits, publication,
state transitions and approvals. Human approval is an exact spec-hash comment
from the repository owner, fetched independently from GitHub. No command posts
that approval or merges a PR.

The first acceptance adapter is declarative stdin/stdout CLI tests. Candidate
files are exported from an exact commit, with symlinks and secret-bearing paths
rejected. Candidate processes run in a dedicated Colima Docker context without
network, capabilities, host credentials, test mounts or daemon sockets. Containers
are read-only, unprivileged and resource-limited. The oracle compares results on
the host; it never imports candidate code. Candidate software sees its runtime
inputs. Raw outputs are not copied into Builder feedback.

These controls protect against agent mistakes and hostile candidate code inside
the tested boundary. They do not protect against the workstation administrator,
compromised OS/hypervisor/provider, or the operator intentionally overriding gates.
GitHub Free does not enforce branch protections for private repositories.

## Current adapter limits

CLI contracts only. Public checks execute in the same restricted candidate
container. Dependencies must already be supplied by the pinned image or tracked
candidate; network installs, native macOS testing, UI browsers, HTTP service
orchestration and privileged infrastructure changes need reviewed adapters.
Do not enrol a project whose required verification cannot run this way.

Agent response schemas establish shape, not correctness. Deterministic tests,
negative controls and independent review are distinct gates. Test strength and
post-merge defects must be measured before claiming productivity improvements.
