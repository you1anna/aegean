# Spec Delta

## Purpose

Give operators repeatable commands to build the source, diagnose the installed host and prepare a controlled pilot without manual release paths.

## ADDED Requirements

### Requirement: R001 Local build commands
The repository SHALL provide `./scripts/dev` with help, setup, build, check and test commands. Commands MUST resolve the repository from the script location, use pinned tools, preserve lockfiles and return failures. Build and test commands MUST NOT install a release, start a VM or call models.

#### Scenario: Repeatable build
- **WHEN** the operator runs setup and build twice from a path with spaces
- **THEN** both builds use locked dependencies and obsolete compiled files cannot survive
- **AND** unrelated files and installed releases remain unchanged

#### Scenario: Failed prerequisite
- **WHEN** a pinned tool is absent or dependency setup fails
- **THEN** the command exits nonzero with the failed step and a recovery command
- **AND** later steps do not execute

### Requirement: R002 Stable diagnostics and host commands
The installed CLI SHALL expose release information, authentication status/login and verifier status/start/stop commands. It MUST resolve its own release, preserve the selected Docker context and use toolchain limits. Read-only commands MUST NOT repair state or call models. Doctor MUST support explicit prerequisite and full-readiness exit checks.

#### Scenario: Stopped verifier
- **WHEN** the operator runs verifier start twice
- **THEN** one dedicated VM runs with the reviewed configuration
- **AND** repeated execution preserves other profiles and Docker context

#### Scenario: Unresolved ownership
- **WHEN** verifier stop encounters active or uncertain Aegean resources
- **THEN** it refuses the stop and reports the recovery action without force or automatic takeover

#### Scenario: Prerequisite check
- **WHEN** doctor checks prerequisites on a host without full acceptance
- **THEN** it succeeds only if every prerequisite passes and reports full acceptance separately

### Requirement: R003 Project validation before execution
The CLI SHALL validate project configuration, task scope, explicit budgets, approver, repository identity, clean base and verifier compatibility before run allocation. Validation MUST NOT execute project commands, modify files, enrol a project or create a run. Unsupported compatibility MUST remain unverified or fail.

#### Scenario: Old configuration
- **WHEN** a project uses schema 1 or lacks model execution limits
- **THEN** validation reports the affected fields and review procedure
- **AND** no run directory, lease or model call is created

### Requirement: R004 Explicit pilot preparation
`aegean prepare --request FILE` SHALL create a durable run without a model call after validation. It MUST return the run ID and next command. Repeated preparation for an existing unfinished request and base MUST return the matching run or an explicit conflict, without duplicate ownership. Existing start behaviour MUST remain compatible.

#### Scenario: Interrupted preparation
- **WHEN** preparation stops after a durable effect and the operator repeats it
- **THEN** the command reconciles that effect or reports the retained run for recovery
- **AND** it does not create a second run or reset consumed budgets

### Requirement: R005 Reusable pilot limits
Pilot authorisation SHALL accept a strict versioned JSON limits file as an alternative to existing budget flags. It MUST reject mixed inputs and invalid limits. It MUST bind an absolute expiry, request, repository, host, policy and release through the existing human confirmation. The file MUST NOT constitute approval or override project token limits.

#### Scenario: Pilot limits preview
- **WHEN** the operator authorises a prepared run with a valid limits file
- **THEN** the terminal displays exact effective limits, token policy and expiry for human confirmation
- **AND** no model call starts before a separate resume

#### Scenario: Invalid authorisation
- **WHEN** the file contains unknown fields, excessive limits or an unsupported version
- **THEN** authorisation fails before approval persistence or execution

### Requirement: R006 Private run diagnostics
Run commands SHALL capture console output privately without external tee pipelines. Logs MUST preserve exit status, interruption and interactive decisions. Logs MUST exclude credentials, prompts and protected suite content. Commands MUST report log and run paths and a note summary without automatically committing documentation.

#### Scenario: Log failure
- **WHEN** the private log cannot be created before execution
- **THEN** the command fails before a model call
- **AND** a mid-run logging failure stops further calls and retains recovery records

#### Scenario: Output capacity
- **WHEN** a log reaches its documented size limit
- **THEN** capture remains bounded and visibly reports omitted output without blocking child cleanup

### Requirement: R007 Concurrency and recovery
Mutating host and build commands SHALL prevent conflicting operations through scoped ownership. Existing run permits, short metadata transactions and uncertain-effect recovery MUST remain enforced. Contention MUST report the owner; no command may delete stale ownership automatically.

#### Scenario: Concurrent setup
- **WHEN** two setup commands target the same checkout
- **THEN** one owns the mutation and the other fails without changing dependencies or build output

### Requirement: R008 Discoverable documentation
Help and documentation SHALL describe command purpose, side effects, configuration ownership, exit results and recovery. They MUST include a verified local build path and pilot walkthrough. Proposed commands, synthetic results and live acceptance MUST be distinguished. Existing commands MUST remain available.

#### Scenario: Documentation verification
- **WHEN** the documented walkthrough runs against synthetic fixtures
- **THEN** all commands parse and expected checkpoints occur without hard-coded release paths or live model calls

### Requirement: R009 Recoverable uninstall
An explicit uninstall SHALL remove only managed executable and skill links, remove managed instruction blocks, and archive the installation. It MUST preserve private state, evidence, provider authentication, external runtimes and VM storage. Active or uncertain ownership MUST block uninstall. A durable journal MUST permit retry and block concurrent installation until completion.

#### Scenario: Fresh installation baseline
- **WHEN** the operator requests uninstall on a confirmed quiescent host
- **THEN** the command archives the installation and reports its backup path
- **AND** unrelated instructions and private records remain unchanged

#### Scenario: Interrupted removal
- **WHEN** uninstall stops after removal of a managed link
- **THEN** the source uninstall command can resume the exact journal
- **AND** changed or unmanaged destinations are preserved for review

### Requirement: R010 Original bootstrap history
The ledger SHALL preserve absent policy identities only for terminal schema-1 records under policy `0.1.0`. Present identities MUST remain valid hashes. Inspection MUST validate keys and ownership without changing the remote. Migration MUST retain explicit human approval and preserve historical records exactly. Historical records MUST NOT execute or supply current acceptance evidence.

#### Scenario: Terminal history before policy hashes
- **WHEN** a quiescent legacy ledger contains cancelled bootstrap records without policy identities
- **THEN** read-only inspection succeeds without a remote commit
- **AND** explicit migration preserves their absent fields and history

#### Scenario: Unsupported absence
- **WHEN** an active record, another policy or a schema-2 record lacks its required identity
- **THEN** inspection and migration reject it without mutation
