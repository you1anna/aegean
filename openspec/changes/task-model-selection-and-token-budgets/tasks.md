# Tasks

All implementation tasks remain open. This checklist does not grant release or pilot approval.

## 1. Establish scope and adapter controls

- [ ] 1.1 Record approval of this exact specification and the authorised implementation route. Verify the approval identity and scope.
- [ ] 1.2 Confirm pinned-CLI model, effort and usage semantics with synthetic parser fixtures and bounded, authorised capability probes.
- [ ] 1.3 Record unsupported hard-cap controls in the adapter capability table. Verify strict mode rejects them before process creation.

## 2. Add model policy

- [ ] 2.1 Add pure policy schemas and selection rules. Test routine, unknown, consequential, unavailable and changed-model cases.
- [ ] 2.2 Bind models, effort, context and qualification digests to each new run. Test drift rejection and old-run compatibility.
- [ ] 2.3 Pass explicit settings to Claude and Codex. Assert exact arguments and preserve every existing subscription and tool restriction.
- [ ] 2.4 Document model selection in architecture and operations. Check each documented selection against a policy fixture.

## 3. Bound role context

- [ ] 3.1 Add deterministic context manifests. Test mandatory-first selection, dependency overflow, Unicode sizes and omitted optional paths.
- [ ] 3.2 Bound cumulative Builder tool output. Test repeated reads, oversized results and interruption without truncation that appears complete.
- [ ] 3.3 Preserve complete contract and diff checks. Test that protected tests and credentials never enter Builder context.
- [ ] 3.4 Document byte limits, token estimates and hidden CLI input. Verify the reports distinguish these measures.

## 4. Add token accounting and admission

- [ ] 4.1 Add provider-specific usage parsers. Test cumulative, incremental, cached, reasoning, duplicate, malformed and missing counts.
- [ ] 4.2 Add pure reservation and settlement rules. Test exact limits, overruns, invalid integers and unchanged totals across revisions.
- [ ] 4.3 Integrate admission before every role call. Assert zero process starts after token, pilot, time, repair or revision rejection.
- [ ] 4.4 Store usage by effect identity. Test repeated settlement and reconstruction after completion but before usage persistence.
- [ ] 4.5 Retain uncertain reservations. Test competing owners, stale generations, lost effects and interruption at each durable boundary.
- [ ] 4.6 Add status fields and recovery instructions. Verify known, unknown, exceeded and reserved values without private prompt content.

## 5. Integrate with the bounded CLI lifecycle

- [ ] 5.1 Complete the existing pilot, decision and recovery dependencies. Verify the remaining-work checks in bounded CLI progress.
- [ ] 5.2 Test local approval, expired pilot, smaller-model failure, baseline repair, revised contract and lost-effect recovery together.
- [ ] 5.3 Verify the same suite and exact approvals remain required. Reject stale base, head, policy, review and verification evidence.
- [ ] 5.4 Update operations, acceptance and the shipped skill. Check that none describes unqualified models or monitored limits as hard caps.

## 6. Verify and qualify

- [ ] 6.1 Run `npm ci`, `npm run check` and `npm test`. Record the final commit, results, duration and any unresolved failures.
- [ ] 6.2 Obtain independent review of policy, accounting and recovery. Resolve findings and repeat affected checks.
- [ ] 6.3 Prepare a bounded qualification candidate. Record its models, effort, task classes, allowances and fixture manifest for approval.
- [ ] 6.4 Run authorised paired comparisons. Verify every threshold in the design, including all repairs and escalations.
- [ ] 6.5 Retain baseline selection for failed classes. Activate only qualified entries and test rejection of stale qualification evidence.
- [ ] 6.6 Review README and its immediate links against delivered behaviour. Keep technical evidence in the engineering reference.
- [ ] 6.7 Update the current PR with verified results and outstanding gates. Confirm the remote head and hosted checks for that candidate.

## Workflow follow-up

- Installation and a real pilot require separate approval.
- Only the human merges the PR.
- Archive this change after implementation, verification and review satisfy the repository workflow.
