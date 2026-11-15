# trim

### Requirement: trim

Remove trailing LF characters. Remove ASCII spaces from both ends. Preserve internal spaces, tabs and non-ASCII characters. Append one LF.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
