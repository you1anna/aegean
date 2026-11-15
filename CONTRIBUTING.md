# Contribute to Aegean

[Overview](README.md) · [Guides](docs/README.md) · [Engineering](docs/ENGINEERING.md)

Help make each change easier to understand, use and review. Clear bug reports,
focused improvements and useful documentation all contribute to that result.
Read [AGENTS.md](AGENTS.md) for repository rules and [the accepted plan](docs/PLAN.md) for scope.

## Check the source

Use the Node version in [mise.toml](mise.toml). From the repository root, run:

```sh
mise install
mise exec -- npm ci --ignore-scripts --no-audit --no-fund
mise exec -- npm run check
mise exec -- npm test
```

These commands install development dependencies, check types, build the source
and run the automated tests. They do not install an Aegean release.
The suite uses synthetic fixtures and temporary directories.

After a branch change, move any old `dist/` output aside before these checks.
The build does not remove obsolete compiled files.

Passing tests establish only the behaviour they exercise. Native containment,
live provider calls and real pilot acceptance need separate evidence.
See [current results and gaps](docs/STATUS.md).

## Make a change

1. Read the relevant guide and source before you edit.
2. Follow the approval path in [AGENTS.md](AGENTS.md). Significant engineering
   work needs an approved specification, an isolated branch and human review.
3. Keep the change focused. Preserve the [module boundaries](docs/ARCHITECTURE.md#code-structure).
4. Add appropriate automated coverage for behaviour changes. Test rejection and
   recovery as well as success.
5. Run the checks above on the final state. Check Markdown links and run
   `git diff --check` for documentation changes.
6. Report the result, the checks you ran and any unverified behaviour.

Use synthetic data in tests and examples. Keep credentials, protected suites,
raw prompts and run files outside Git. For a real run, follow
[run records and debugging](docs/OPERATIONS.md#run-records-and-debugging).

## Report a problem

Include the expected result, observed result, source commit or installed release,
host type and the smallest synthetic reproduction. Summarise relevant failed
checks from `aegean doctor --json`.

Keep raw diagnostics private. Reports must not expose credentials, protected test
content or data from another project.

## Documentation

Make clarity and simplicity govern technical complexity. Lead with the useful
result for the reader and the capabilities that support it.

### Review the reader's path in every pull request

1. State the value that the change delivers and the evidence for it.
2. Review the README and every guide it links to directly.
3. Update the affected pages together so the introduction, examples and next steps agree.
4. Keep the main path focused on user outcomes, supported use and clear actions.
5. Put technical decisions, trial history and unfinished work in the engineering references.
6. Keep material limits visible where they affect use. Do not present proposed or unaccepted behaviour as available.
7. Check links, heading order and image descriptions. Preview layout changes.

If a change has no effect on the reader's path, record that in the pull request.
Do not add a top-level progress note for every internal change.

### Write with restraint

- Put the reader's purpose first. Explain what a command does before you show it.
- Use short sentences, common words and UK English. Explain a technical term
  when the reader first needs it.
- Give each fact one home. Link to detail instead of copying it between guides.
- Separate implemented behaviour, observed trial results and proposed changes.
- Use a small, verifiable example. Never imply that a trial is a production guarantee.
- Use descriptive links and useful image descriptions. Keep the heading order clear.

Keep the overview short. Put procedures in the operations guide and evidence in
the status record. Preserve dated trial records and approved decisions.
Use the [guides](docs/README.md) for reader tasks and the [engineering reference](docs/ENGINEERING.md) for technical records.
