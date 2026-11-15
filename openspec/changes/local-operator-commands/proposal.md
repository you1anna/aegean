# Proposal

## Why

Operators currently need release-specific paths, manual log capture and long command sequences to build Aegean or prepare a pilot.
The bootstrap combines tests, VM setup and installation, while project validation does not establish readiness for a run.

## What Changes

- Provide a local `./scripts/dev` entry point for help, dependency setup, build, check and test.
- Provide stable installed commands for release information, authentication, verifier control and project validation.
- Add explicit run preparation and file-based pilot limits, with existing human decisions and resume commands retained.
- Capture private run logs automatically and report exact failures, recovery actions and run identifiers.
- Document configuration ownership, supported commands and an end-to-end pilot example without version-specific paths.
- Preserve existing command compatibility, release installation, native qualification and acceptance boundaries.

## Capabilities

### New Capabilities

- `operator-commands`: Reproducible local builds, host diagnostics and controlled pilot preparation through a documented command interface.

### Modified Capabilities

None. The main specification inventory is empty. Existing implementation and approved change constraints remain applicable.

## Impact

Affected areas include scripts, the CLI, host adapters, project validation, run preparation, logging, tests and user documentation.
Reuse the maintained installer, existing schemas, process adapter, ownership permits and approval records.
No new task framework, scheduler, model dependency or automatic deployment is proposed.
This proposal does not authorise installation, model calls, acceptance, publication or changes to pilot project.
