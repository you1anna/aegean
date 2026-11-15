# Operator command review

## Scope and approval

The operator approved the [operator command specification](../openspec/changes/local-operator-commands/specs/operator-commands/spec.md) on 15 November 2026.
The approval covers the PR #2 manual source-work exception, synthetic tests and independent review.
The approved scope includes a recoverable uninstall. Installation requires a separate operator action.
The later bootstrap compatibility fix received explicit approval in the same chat.

This exception does not establish protected verification, native qualification or full release acceptance.
No live model calls form part of this implementation.

## Independent review

A separate reviewer inspected the source and final corrective changes without editing them.
The review found the following issues, which received fixes and regression coverage:

| Finding | Correction |
| --- | --- |
| Uncertain verifier transitions released their reservation | Start, stop and first provisioning retain uncertain ownership |
| Missing budgets allocated partial runs | Shared preflight rejects them before allocation |
| Lost preparation confirmation had no recovery path | Exact requested intents reconcile only after the owner stops |
| Start and cleanup commands could race host transitions | Admission covers start, preparation, decisions and cleanup |
| Configuration hashes removed the final newline | Policy hashes use exact committed bytes |
| Source setup preceded its lock | The launcher lock covers runtime setup and source tasks |
| Build descendants could survive parent exit | Process-group cleanup completes before task release |
| Uninstall journal paths were insufficiently constrained | Strict canonical destinations and durable writes precede removal |
| Installed guides lacked their example files | The installer ships and hashes the examples |
| The guide recommended a retired native probe | The supported procedure uses `aegean qualify` |
| Original terminal records lacked later policy hashes | Narrow historical validation preserves absence without permission to execute |

The final independent review found no remaining blocking source issue in the reviewed changes.
Review is not evidence of native containment or provider behaviour.

## Verification

The baseline passed all 175 synthetic tests with no failures or skips in 595.83 seconds.
A regression reproduced the missing-budget allocation before the correction.
A regression also reproduced rejection of valid original bootstrap history before the compatibility correction.

The first combined run passed 187 tests and failed one installer fixture because it lacked the new examples directory.
The fixture now includes committed examples and verifies their installed contents and artifact manifest entry.
The subsequent focused run passed 24 command, ledger and provenance tests with no failures or skips.
Source-task, uninstall and provisioning fixtures also passed, including partial uninstall retry and uncertain setup recovery.

Final full-suite results and the installed-host outcome are recorded in [Status](STATUS.md).
The [operations guide](OPERATIONS.md) owns the commands and recovery procedures.

## Fresh-install Docker correction

The bootstrap must not depend on a Docker client inside an uninstall backup.
Bootstrap now downloads the official archive and checks committed archive and binary hashes for each supported Mac architecture.
The release includes the client in its artifact manifest. Its wrapper selects a Docker-only directory without a shell PATH export.
A separate reviewer caught and confirmed the fix for accidental selection of the release's older Claude during upgrade.
The wrapper fixture checks pinned Docker selection alongside a newer external Claude.

Temporary-storage verification passed with a fresh official ARM64 download, executable version check and repeat use.
Both official architecture archives supplied the committed hashes; native Intel execution remains untested.
Synthetic checks cover checksum failure, network failure, cache corruption, concurrent ownership and retry.
No real Aegean installation or VM start formed part of this correction.

The follow-up full run passed 190 of 191 tests in 622.04 seconds.
Its compiled installer fixture still expected the pre-review Docker path and failed after the Docker-only directory correction.
After a rebuild, all 35 affected installer and script tests passed with no failures or skips in 27.02 seconds.
Type checks, script syntax, documentation links, shell examples and strict OpenSpec validation also passed.
The final independent review found no remaining blocking issue.
