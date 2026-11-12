// The former host-workspace Builder could leave detached writers running.
// Keep this historical entry point fail-closed; qualification and pilots use the VM adapter.
throw new Error("This host-Builder entry point is retired. Run aegean qualify for native containment checks, then explicitly authorize aegean pilot for subscription execution; see docs/OPERATIONS.md.");
