# Tasks

Source implementation uses the recorded manual review exception. This checklist does not grant release or pilot approval.

## 1. Establish scope and adapter controls

- [x] 1.1 Record approval of this exact specification and the authorised implementation route. Verify the approval identity and scope.
- [ ] 1.2 Confirm pinned-CLI model, effort and usage semantics with synthetic parser fixtures and bounded, authorised capability probes.
- [x] 1.3 Record unsupported hard-cap controls in the adapter capability table. Verify strict mode rejects them before process creation.

## 2. Add model policy

- [x] 2.1 Add pure policy schemas and selection rules. Test routine, unknown, consequential, unavailable and changed-model cases.
- [x] 2.2 Bind models, effort, context and qualification digests to each new run. Test drift rejection and old-run compatibility.
- [x] 2.3 Pass explicit settings to Claude and Codex. Assert exact arguments and preserve every existing subscription and tool restriction.
- [x] 2.4 Document model selection in architecture and operations. Check each documented selection against a policy fixture.

## 3. Bound role context

- [x] 3.1 Add deterministic context manifests. Test mandatory-first selection, dependency overflow, Unicode sizes and omitted optional paths.
- [x] 3.2 Bound cumulative Builder tool output. Test repeated reads, oversized results and interruption without truncation that appears complete.
- [x] 3.3 Preserve complete contract and diff checks. Test that protected tests and credentials never enter Builder context.
- [x] 3.4 Document byte limits, token estimates and hidden CLI input. Verify the reports distinguish these measures.

## 4. Add token accounting and admission

- [x] 4.1 Add provider-specific usage parsers. Test cumulative, incremental, cached, reasoning, duplicate, malformed and missing counts.
- [x] 4.2 Add pure reservation and settlement rules. Test exact limits, overruns, invalid integers and unchanged totals across revisions.
- [x] 4.3 Integrate admission before every role call. Assert zero process starts after token, pilot, time, repair or revision rejection.
- [x] 4.4 Store usage by effect identity. Test repeated settlement and reconstruction after completion but before usage persistence.
- [x] 4.5 Retain uncertain reservations. Test competing owners, stale generations, lost effects and interruption at each durable boundary.
- [x] 4.6 Add status fields and recovery instructions. Verify known, unknown, exceeded and reserved values without private prompt content.

## 5. Integrate with the bounded CLI lifecycle

- [x] 5.1 Complete the existing pilot, decision and recovery dependencies. Verify the remaining-work checks in bounded CLI progress.
- [x] 5.2 Test local approval, expired pilot, smaller-model failure, baseline repair, revised contract and lost-effect recovery together.
- [x] 5.3 Verify the same suite and exact approvals remain required. Reject stale base, head, policy, review and verification evidence.
- [x] 5.4 Update operations, acceptance and the shipped skill. Check that none describes unqualified models or monitored limits as hard caps.

## 6. Verify and qualify

- [x] 6.1 Run `npm ci`, `npm run check` and `npm test`. Record the final commit, results, duration and any unresolved failures.
- [x] 6.2 Obtain independent review of policy, accounting and recovery. Resolve findings and repeat affected checks.
- [ ] 6.3 Prepare a bounded qualification candidate. Record its models, effort, task classes, allowances and fixture manifest for approval.
- [ ] 6.4 Run authorised paired comparisons. Verify every threshold in the design, including all repairs and escalations.
- [x] 6.5 Retain baseline selection for failed classes. Activate only qualified entries and test rejection of stale qualification evidence.
- [x] 6.6 Review README and its immediate links against delivered behaviour. Keep technical evidence in the engineering reference.
- [x] 6.7 Update the current PR with verified results and outstanding gates. Confirm the remote head and hosted checks for that candidate.

Live capability probes and paired qualification remain outside the approved source-work exception.
The [qualification candidate](qualification.md) records the preparation that still needs exact models, allowances and fixture hashes.

## Workflow follow-up

- Installation and a real pilot require separate approval.
- Only the human merges the PR.
- Archive this change after implementation, verification and review satisfy the repository workflow.
