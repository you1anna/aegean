# exit-code

### Requirement: exit-code

Remove at most one final LF from input. Map the exact string ok to exit 0 and retry to exit 3. Map everything else to exit 2. Always emit empty stdout.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
