For significant engineering work, use Aegean (`aegean doctor`, then the `aegean`
skill). This supersedes direct-to-main delivery for significant work: use an
isolated branch, approved specification, protected verification and human-reviewed
PR. Simple low-risk operations retain proportionate checks and the existing Git
workflow. Scope is based on impact, not line count. Do not silently downgrade a
significant change because a required Aegean capability is unavailable; planning
and investigation can continue while the missing gate is resolved.

Project data restrictions and production/deployment approvals still apply. Do not
enrol sensitive, parked, third-party or production checkouts automatically. Aegean
uses subscription CLIs only, never paid API fallback. Follow the installed skill
for capability status. The initial Aegean bootstrap uses its explicitly recorded
manual review exception; that exception does not authorise ordinary work to
bypass the workflow.
