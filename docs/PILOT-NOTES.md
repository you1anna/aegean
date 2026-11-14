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
