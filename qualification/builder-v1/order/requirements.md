# order

### Requirement: order

Preserve line order and internal empty lines. Remove all trailing LF characters, then append exactly one LF. Preserve CR characters as data.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
