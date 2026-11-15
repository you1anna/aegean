# From request to reviewed change

[Overview](../README.md) · [Guides](README.md)

Aegean gives each stage a clear result for the next decision. The specification
states the intended change. The candidate contains the code. The evidence shows
what the checks establish.

## 1. Make the request clear

Describe the problem, the useful outcome and the constraints. The Scout turns
that request into an OpenSpec specification for your review.

**Your result:** a concrete scope and success criteria you can discuss before
implementation.

## 2. Agree on the scope

Review the specification and request changes where needed. Your approval identifies
an exact revision, so later checks refer to the same agreement.

**Your result:** a shared definition of the change and how to assess it.

## 3. Produce a candidate and evidence

An independent Auditor prepares protected tests from the approved specification.
The Builder creates a candidate in an isolated worktree. The verifier checks the
candidate, and the Auditor reviews it in a fresh context.

**Your result:** a proposed change with test and review evidence. Bounded repair
attempts let the Builder address failures without an open-ended loop.

This stage requires release acceptance. Full delivery remains under evaluation;
see [supported use](README.md#supported-use) before a run.

## 4. Decide what to publish and merge

Review the candidate and its evidence. You approve publication before Aegean pushes
the candidate code. You then decide whether to merge the pull request.

**Your result:** a deliberate delivery decision tied to the reviewed change.
Aegean never supplies your approval or merges on your behalf.

## Continue

For commands, approval steps and recovery, use the [operations guide](OPERATIONS.md).
For roles and trust boundaries, read the [architecture](ARCHITECTURE.md).
