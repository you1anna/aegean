# echo

### Requirement: echo

Read one valid UTF-8 line. Remove all trailing LF characters, then append exactly one LF. Preserve every other character.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
