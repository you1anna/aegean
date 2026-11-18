# Contribute to Aegean

[Overview](README.md) · [Guides](docs/README.md) · [Engineering](docs/ENGINEERING.md)

Read [AGENTS.md](AGENTS.md) for repository rules and [the accepted plan](docs/PLAN.md) for scope.

## Check the source

Use the local script from the repository root:

```sh
./scripts/dev setup
./scripts/dev check
./scripts/dev test
```

`setup` installs the pinned runtime and locked dependencies. `check` checks types and script syntax.
`test` removes old compiled output, builds the source and runs the synthetic suite.
For a compile without tests, use `./scripts/dev build`. Use `./scripts/dev help` for the command list.
The script resolves the checkout from its own location, so paths with spaces work.
These commands do not install a release, start a VM or call models.

The existing `npm ci`, `npm run check` and `npm test` commands remain available under the pinned runtime.
The script serialises source tasks. A retained lock under `.aegean/` requires process inspection before manual removal.
Never remove a live owner's lock. After interruption, correct the failed step and repeat the command.

Passing tests establish only the behaviour they exercise. Native containment,
live provider calls and real pilot acceptance need separate evidence.
See [current results and gaps](docs/STATUS.md).

## Make a change

1. Read the relevant guide and source before you edit.
2. Follow [AGENTS.md](AGENTS.md). Use a branch and human-reviewed PR for every
   change, including documentation. Significant engineering work also needs an approved specification.
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

Describe what the software does, what it produces and how to use it.

### Check the docs in every pull request

1. Explain what the change lets the user do. Support the claim with observed behaviour.
2. Review the README and every guide it links to directly.
3. Update the affected pages together so the introduction, examples and next steps agree.
4. Use the overview and guides to explain supported tasks, their results and the steps to follow.
5. Put technical decisions, trial history and unfinished work in the engineering references.
6. Keep material limits visible where they affect use. Do not present proposed or unaccepted behaviour as available.
7. Check links, heading order and image descriptions. Preview layout changes.

If the change needs no documentation update, explain why in the pull request.
Do not add a top-level progress note for every internal change.

### Wording

- Describe actions, outputs and checks. Do not use slogans, promotional language or vague promises.
- Explain what a command does before you show it.
- Use short sentences, common words and UK English. Explain a technical term
  when the reader first needs it.
- Give each fact one home. Link to detail instead of copying it between guides.
- Separate implemented behaviour, observed trial results and proposed changes.
- Use a small, verifiable example. Never imply that a trial is a production guarantee.
- Use descriptive links and useful image descriptions. Keep the heading order clear.

### Diagrams

- Use one diagram for one question: workflow, components or an execution boundary.
- Keep Mermaid source beside the explanation. Use named nodes, labelled data flows, `accTitle` and `accDescr`.
- Match the existing navy, pale blue and peach palette. Labels and boundaries must carry meaning without colour.
- State what crosses each trust boundary. Distinguish a model call from the process that executes candidate code.
- Preview diagrams at the normal GitHub content width. Check labels, arrows, contrast and the page in light and dark themes.

Keep the overview short. Put procedures in the operations guide and evidence in
the status record. Preserve dated trial records and approved decisions.
Use the [guides](docs/README.md) for reader tasks and the [engineering reference](docs/ENGINEERING.md) for technical records.
