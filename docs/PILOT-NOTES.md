# Pilot run notes

Project names and run identifiers are anonymised. Original records stay outside Git.

One entry per real run, newest first, written by the session that ran it. The
purpose is debugging: what was attempted, how far it got, what broke and where
the evidence is. [OPERATIONS](OPERATIONS.md#run-records-and-debugging) owns
where the underlying records live; [STATUS](STATUS.md) owns current state.

Rules: at most fifteen lines per entry. Identifiers, outcomes and local paths
only; no copied logs, prompts, suite content or project data. A defect found
here is fixed through the normal branch and PR, then linked from its entry.

## Template

```markdown
## <run-id> — <project> — <date>

- Host and release: <host>, <installed release>
- Request: <one line>
- Reached: <last state>, by <command>
- Outcome: <passed | blocked | failed | cancelled>, with the exact message
- Usage: <per role: seconds, tokens as reported; unknown is not zero>
- Records: retained locally outside Git; identifiers in this document are anonymised.
- Findings: <defect or surprise, one line each>
- Follow-up: <issue, commit or PR>
```

## canary-01 — pilot project — 26 November 2026

- Host and release: primary host, `0.1.0-d89f10e1d2a2` (source `edb8bac`, policy 0.8.0); `aegean guide`
- Request: the saved canary request in the guide's private `requests/` folder
- Reached: the request step of the guide. Host, runs and project checks passed. No run was created.
- Outcome: blocked. `aegean prepare` failed twice with "ENOENT: no such file or directory, lstat"
- Usage: none. No model call, no authorisation and no run directory
- Records: console capture and two diagnostic logs retained locally outside Git.
- Findings: "Use a request file" asked for a typed path. The guide resolved a relative path against the project folder,
  not against its own `requests/` folder, so the saved request was not found. The baseline measures were not collected.
- Follow-up: PR #3 (the guide lists the saved requests). Not installed at the time of this note.

## trial-05 — pilot project — 25 November 2026

- Host and release: primary host, `0.1.0-2511305b1adf` (source `8401e10` in the archive, `2d6937d` here, policy 0.7.0); `aegean guide`
- Request: a data foundation that names every field of each record type; structure and storage left to the Scout
- Reached: `spec-drafted` at 12:42 UTC, by `aegean resume` from the guide; prepared on 17 November, authorised at 12:33 UTC
- Outcome: cancelled. The authorisation expired at 13:01 UTC during the specification review, 19 minutes after the draft
- Usage: Scout 347 seconds; 55,295 tokens reported (7,959 input, 47,336 output, 649 cached); 1 of 6 pilot calls;
  `claude-sonnet-5-5`, high effort, requested and reported
- Limits: 30 minutes, 6 calls, 20 active minutes, from the saved guide limits
- Records: retained locally outside Git; identifiers in this document are anonymised.
- Findings: the specification had 49 KB in six files (contract 33 KB); the guide offered the saved 30-minute limits first;
  the project's `verifier.command` was its test runner, so no protected case could pass; the Builder prompt did not say how to
  write a file through its only tool; no Builder session has been measured against the per-call token allowance of 400,000
- Follow-up: PR #2 (case rules, Builder file writes, limits) and PR #1 (file paths at the review)

## trial-03 — pilot project — 16 November 2026

- Host and release: primary host, `0.1.0-1d675fce0213` (source `46d1238`, policy 0.5.0); first real run with `aegean guide`
- Request: a data model; structure, storage and technology left to the Scout
- Reached: `spec-drafted` at 23:47 UTC, by `aegean resume` from the guide; local approval mode, no push
- Outcome: blocked at specification review; a reviewer advised cancellation. The run was not cancelled when this entry was written
- Usage: Scout 67 seconds; 16,171 tokens reported (10,148 input, 6,023 output, 3,293 cached); 1 of 6 pilot calls;
  `claude-sonnet-5`, medium effort, requested and reported
- Limits: 30 minutes, 6 calls, 20 active minutes; the authorisation ended at 00:13 UTC, 26 minutes after the draft
- Records: retained locally outside Git; identifiers in this document are anonymised.
- Findings: the Scout context had 5 files (12,065 bytes); the draft named eight record types without fields, left the identifier
  format open and moved the section 6 fields to a later change (4 open questions, 3 `NOT COVERED` entries);
  the guide pushed each opened file off the screen; the guide did not show the expiry at the review;
  an earlier `prepare` failed in 24 ms with no recorded cause; `trial-04` stays `requested` from an older release
- Follow-up: [STATUS](STATUS.md), 17 November section

## trial-02 — pilot project — 16 November 2026

- Host and release: primary host, `0.1.0-bc78bef49e53`
- Request: data foundation for pilot project; goal only, design left to the Scout
- Reached: `spec-drafted`, by `aegean resume`; local approval mode, no push
- Outcome: blocked at specification review; the operator did not approve the draft
- Usage: Scout 95 seconds; 17,605 tokens reported (9,278 input, 8,327 output, 3,293 cached); 1 of 12 calls
- Records: retained locally outside Git; identifiers in this document are anonymised.
- Findings: the Scout context had 4 files (10,791 bytes) and no `.gitignore` or check commands; the draft put
  committed samples in an ignored path and planned no automated check; a stale project rule removed all code
  from the plan without a report; a second `authorize-pilot` asked for the confirmation, then failed with `EEXIST`;
  `status` gave no next step
- Follow-up: [STATUS](STATUS.md), 16 November specification section
- Cancel attempt: on `0.1.0-0c289ca0c4d2` (policy 0.5.0), `aegean cancel` failed with "run policy differs
  from installed policy". Diagnostic log `~/Library/Logs/aegean/<timestamp>-*.jsonl`. The run stays
  `spec-drafted`. Fix: [STATUS](STATUS.md), 16 November cancel section

## trial-01 — pilot project — 14 November 2026

- Host and release: primary host, `0.1.0-6a00b329342a`
- Request: Python CLI parser, specification only
- Reached: `spec-drafted`, by `aegean start`; draft PR #1 opened for approval
- Outcome: cancelled on the operator's instruction; PR closed, branch kept
- Usage: Scout 123 seconds, 17,191 output tokens reported; input unknown (the
  reported count of 2 is not credible)
- Records: retained locally outside Git; identifiers in this document are anonymised.
- Findings: the waiting run held the single global lease; `aegean.json` named
  Python commands with the Node image; the run started although readiness was
  false, because only later stages are guarded
- Follow-up: [STATUS](STATUS.md), 14 November section
